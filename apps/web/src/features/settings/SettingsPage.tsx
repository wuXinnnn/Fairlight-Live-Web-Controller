import { type View, type ViewChannelColor, type ViewChannelRef } from '@flwc/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ConnectionStatus } from '../../components/ConnectionStatus.js';
import { createLocalId } from '../../lib/ids.js';
import { navigate, setNavigationGuard } from '../../lib/router.js';
import type { ViewsClient } from '../../lib/views-api.js';
import { mixerStore } from '../../store/mixer-store.js';
import {
  clearViewError,
  createView,
  deleteView,
  updateView,
  viewStore,
} from '../../store/view-store.js';
import { emptyStateDetail, emptyStateTitle, resolveMixerEmptyState } from '../mixer/empty-state.js';
import {
  duplicateChannelNames,
  referenceForChannel,
  resolveViewChannels,
} from '../mixer/view-resolver.js';
import { AvailableChannelList } from './AvailableChannelList.js';
import { ChannelOrderList } from './ChannelOrderList.js';
import { pad } from './channel-labels.js';
import { DiscardChangesDialog, type PendingAction } from './DiscardChangesDialog.js';
import type { FlipListHandle } from './use-flip-list.js';
import { isViewDirty } from './view-dirty.js';
import { ViewDndContext } from './ViewDndContext.js';
import {
  addGroup,
  assignGroup,
  moveChannel,
  moveGroup,
  removeGroup,
  renameGroup,
  setGroupColor,
  type MoveDirection,
} from './view-order.js';

interface SettingsPageProps {
  viewsClient: ViewsClient;
  onBack(): void;
  onOpenConnection(): void;
}

function copyView(view: View): View {
  return {
    ...view,
    channels: view.channels.map((channel) => ({ ...channel })),
    groups: view.groups.map((group) => ({ ...group })),
  };
}

function withColor(reference: ViewChannelRef, color?: ViewChannelColor): ViewChannelRef {
  const next: ViewChannelRef = { kind: reference.kind, name: reference.name };
  if (reference.channelId !== undefined) {
    next.channelId = reference.channelId;
  }
  if (reference.groupId !== undefined) {
    next.groupId = reference.groupId;
  }
  if (color !== undefined) {
    next.color = color;
  }
  return next;
}

export function SettingsPage({ viewsClient, onBack, onOpenConnection }: SettingsPageProps) {
  const { views, saving, error } = useStore(
    viewStore,
    useShallow((state) => ({
      views: state.views,
      saving: state.saving,
      error: state.error,
    })),
  );
  const {
    channels,
    channelOrder,
    channelInventoryLoaded,
    socketConnected,
    emberStatus,
    emberLastError,
  } = useStore(
    mixerStore,
    useShallow((state) => ({
      channels: state.channels,
      channelOrder: state.channelOrder,
      channelInventoryLoaded: state.channelInventoryLoaded,
      socketConnected: state.socketConnected,
      emberStatus: state.emberStatus,
      emberLastError: state.emberLastError,
    })),
  );
  const availableChannels = useMemo(
    () => channelOrder.map((id) => channels[id]).filter((channel) => channel !== undefined),
    [channelOrder, channels],
  );
  const duplicateNames = useMemo(
    () => duplicateChannelNames(availableChannels),
    [availableChannels],
  );
  const [selectedId, setSelectedId] = useState<string | null>(views[0]?.id ?? null);
  const selected = views.find((view) => view.id === selectedId) ?? views[0] ?? null;
  const [draft, setDraft] = useState<View | null>(null);
  const activeDraft = draft?.id === selected?.id ? draft : selected;
  const [newName, setNewName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  // The FLIP list lives inside ChannelOrderList, which is the component that renders the drag
  // preview; the page only reaches in to re-baseline before a drop and to skip a view switch.
  const flipRef = useRef<FlipListHandle | null>(null);
  const dirty = useMemo(
    () =>
      draft !== null &&
      selected !== null &&
      draft.id === selected.id &&
      isViewDirty(selected, draft),
    [draft, selected],
  );
  // The navigation guard runs outside React's render cycle, so it reads the latest value here.
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  // Which groups are folded shut. Editor state only: it never reaches the view or the server.
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const toggleCollapse = (groupId: string) =>
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (!next.delete(groupId)) {
        next.add(groupId);
      }
      return next;
    });
  const expandGroup = useCallback(
    (groupId: string) =>
      setCollapsedGroupIds((current) => {
        if (!current.has(groupId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(groupId);
        return next;
      }),
    [],
  );
  const forgetCollapsed = (groupId: string) =>
    setCollapsedGroupIds((current) => {
      if (!current.has(groupId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(groupId);
      return next;
    });

  useEffect(() => {
    setNavigationGuard((route) => {
      if (!dirtyRef.current) {
        return true;
      }
      setPendingAction({ kind: 'navigate', route });
      return false;
    });
    return () => setNavigationGuard(null);
  }, []);

  useEffect(() => {
    if (!dirty) {
      return undefined;
    }
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const resolved = useMemo(
    () => (activeDraft === null ? [] : resolveViewChannels(activeDraft, availableChannels)),
    [activeDraft, availableChannels],
  );
  const assignedChannelIds = useMemo(
    () =>
      new Set(
        resolved.map((entry) => entry.channel?.id).filter((id): id is string => id !== undefined),
      ),
    [resolved],
  );
  const missingEntries = channelInventoryLoaded
    ? resolved.filter((entry) => entry.channel === undefined)
    : [];
  const canCleanMissing = channelInventoryLoaded && socketConnected && emberStatus === 'connected';
  // With no channels to list this never resolves to "render strips", so the fallback is unused.
  const channelsEmptyState = resolveMixerEmptyState({
    socketConnected,
    emberStatus,
    emberLastError,
    channelInventoryLoaded,
    channelCount: 0,
    viewChannelCount: null,
  }) ?? { kind: 'waiting' };
  const channelsEmptyDetail = emptyStateDetail(channelsEmptyState);

  const selectView = (view: View) => {
    // Two views can share row keys; without this the shared rows would fly to their new places.
    flipRef.current?.skipNext();
    setSelectedId(view.id);
    setCollapsedGroupIds(new Set());
    setDraft(copyView(view));
    setConfirmDelete(false);
    setLocalError(null);
  };

  /** Applies a pure update to the draft, sourcing the current draft even before the first edit. */
  const editDraft = (update: (source: View) => View | null) => {
    setDraft((current) => {
      const source = current?.id === activeDraft?.id ? current : activeDraft;
      if (source === null || source === undefined) {
        return current;
      }
      return update(source) ?? source;
    });
  };

  const performCreate = async (name: string) => {
    const created = await createView(viewsClient, { name, channels: [], groups: [] });
    if (created !== null) {
      setNewName('');
      selectView(created);
    }
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) {
      setLocalError('Enter a view name.');
      return;
    }
    setLocalError(null);
    if (dirty) {
      setPendingAction({ kind: 'create', name });
      return;
    }
    void performCreate(name);
  };

  const handleSave = async () => {
    if (activeDraft === null) {
      return;
    }
    const name = activeDraft.name.trim();
    if (name.length === 0) {
      setLocalError('View name cannot be empty.');
      return;
    }
    if (activeDraft.groups.some((group) => group.name.trim().length === 0)) {
      setLocalError('Group names cannot be empty.');
      return;
    }
    setLocalError(null);
    const updated = await updateView(viewsClient, activeDraft.id, {
      name,
      channels: activeDraft.channels,
      groups: activeDraft.groups.map((group) => ({ ...group, name: group.name.trim() })),
    });
    if (updated !== null) {
      setDraft(copyView(updated));
    }
  };

  const performDelete = async (id: string) => {
    const deleted = await deleteView(viewsClient, id);
    if (deleted) {
      setSelectedId(null);
      setDraft(null);
      setConfirmDelete(false);
    }
  };

  const handleDelete = () => {
    if (activeDraft === null) {
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (dirty) {
      setPendingAction({ kind: 'delete' });
      return;
    }
    void performDelete(activeDraft.id);
  };

  const handleSelectView = (view: View) => {
    if (view.id === selected?.id) {
      return;
    }
    if (dirty) {
      setPendingAction({ kind: 'select', view });
      return;
    }
    selectView(view);
  };

  /** DISCARD: drops the draft first so the guard and the action see a clean view. */
  const discardPending = () => {
    if (pendingAction === null || selected === null) {
      return;
    }
    const action = pendingAction;
    const targetId = selected.id;
    setPendingAction(null);
    setDraft(null);
    setCollapsedGroupIds(new Set());
    setConfirmDelete(false);
    dirtyRef.current = false;
    switch (action.kind) {
      case 'navigate':
        navigate(action.route);
        break;
      case 'select':
        selectView(action.view);
        break;
      case 'delete':
        void performDelete(targetId);
        break;
      case 'create':
        void performCreate(action.name);
        break;
    }
  };

  const keepEditing = useCallback(() => {
    setPendingAction(null);
    setConfirmDelete(false);
  }, []);

  const toggleChannel = (channelId: string) => {
    const channel = channels[channelId];
    if (channel === undefined) {
      return;
    }
    editDraft((source) => {
      const existing = resolveViewChannels(source, availableChannels).find(
        (entry) => entry.channel?.id === channelId,
      );
      return {
        ...source,
        channels:
          existing === undefined
            ? [...source.channels, referenceForChannel(channel)]
            : source.channels.filter((_, index) => index !== existing.index),
      };
    });
  };

  const handleMoveChannel = (index: number, direction: MoveDirection) => {
    editDraft((source) => moveChannel(source, index, direction));
  };

  const handleMoveGroup = (groupId: string, direction: MoveDirection) => {
    editDraft((source) => moveGroup(source, groupId, direction));
  };

  const handleAssignGroup = (index: number, groupId: string | undefined) => {
    editDraft((source) => assignGroup(source, index, groupId));
  };

  const setChannelColor = (index: number, color?: ViewChannelColor) => {
    editDraft((source) => ({
      ...source,
      channels: source.channels.map((reference, candidate) =>
        candidate === index ? withColor(reference, color) : reference,
      ),
    }));
  };

  const handleAddGroup = (event: FormEvent) => {
    event.preventDefault();
    const name = newGroupName.trim();
    if (name.length === 0) {
      setLocalError('Enter a group name.');
      return;
    }
    setLocalError(null);
    setNewGroupName('');
    editDraft((source) => addGroup(source, { id: createLocalId('group'), name }));
  };

  const handleCleanup = () => {
    if (activeDraft === null || missingEntries.length === 0 || !canCleanMissing) {
      return;
    }
    const missingIndexes = new Set(missingEntries.map((entry) => entry.index));
    editDraft((source) => ({
      ...source,
      channels: source.channels.filter((_, index) => !missingIndexes.has(index)),
    }));
  };

  return (
    <main className="mixer-shell settings-shell" data-theme="dark">
      <header className="console-header settings-header">
        <button
          type="button"
          className="console-back"
          onClick={onBack}
          aria-label="RETURN TO MIXER"
          title="Return to mixer"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M14 8H3.5M8 3.5 3.5 8 8 12.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="square"
            />
          </svg>
          <span>MIXER</span>
        </button>
        <div className="console-brand">
          <span className="console-brand__eyebrow">FAIRLIGHT LIVE / CONTROL DESK</span>
          <h1>VIEW CONFIGURATION</h1>
        </div>
        <ConnectionStatus onOpen={onOpenConnection} />
      </header>

      {(error ?? localError) !== null && (
        <div className="notice settings-notice" role="alert">
          <span>{error ?? localError}</span>
          {error !== null && (
            <button type="button" onClick={clearViewError} aria-label="Dismiss views error">
              DISMISS
            </button>
          )}
        </div>
      )}

      <div className="settings-workbench">
        <aside className="view-index" aria-label="Views">
          <div className="workbench-label">
            <span>01</span>
            <h2>VIEWS</h2>
          </div>
          <form className="new-view-form" onSubmit={handleCreate}>
            <label htmlFor="new-view-name">NEW VIEW</label>
            <div>
              <input
                id="new-view-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Broadcast"
                disabled={saving}
              />
              <button type="submit" disabled={saving}>
                ADD
              </button>
            </div>
          </form>
          <nav className="view-list">
            {views.length === 0 ? (
              <p>NO SAVED VIEWS</p>
            ) : (
              views.map((view, index) => (
                <button
                  type="button"
                  className={view.id === selected?.id ? 'is-selected' : ''}
                  key={view.id}
                  data-dirty={view.id === selected?.id && dirty ? 'true' : undefined}
                  onClick={() => handleSelectView(view)}
                >
                  <span>{pad(index + 1)}</span>
                  <strong>{view.name}</strong>
                  <small>{pad(view.channels.length)} CH</small>
                  {view.id === selected?.id && dirty && (
                    <span className="visually-hidden">Unsaved changes</span>
                  )}
                </button>
              ))
            )}
          </nav>
        </aside>

        <section className="view-editor" aria-label="View editor">
          {activeDraft === null ? (
            <div className="settings-empty">
              <span>CONFIGURATION BAY</span>
              <h2>CREATE A VIEW TO BEGIN</h2>
              <p>Select channels, establish their order, and assign console colors.</p>
            </div>
          ) : (
            <>
              <header className="view-editor__header">
                <div>
                  <span>ACTIVE VIEW / {activeDraft.id.slice(0, 8).toUpperCase()}</span>
                  <input
                    aria-label="View name"
                    value={activeDraft.name}
                    onChange={(event) => setDraft({ ...activeDraft, name: event.target.value })}
                    disabled={saving}
                  />
                </div>
                <div className="view-editor__actions">
                  <button
                    type="button"
                    className="utility-button"
                    onClick={handleDelete}
                    disabled={saving}
                  >
                    {confirmDelete ? 'CONFIRM DELETE' : 'DELETE VIEW'}
                  </button>
                  <button
                    type="button"
                    className={`primary-button ${dirty ? 'is-dirty' : ''}`}
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'SAVING' : 'SAVE VIEW'}
                  </button>
                  {dirty && <span className="unsaved-badge">UNSAVED</span>}
                </div>
              </header>

              <ViewDndContext
                view={activeDraft}
                channels={channels}
                assignedChannelIds={assignedChannelIds}
                listRef={listRef}
                onDrop={editDraft}
                onBeforeDrop={() => flipRef.current?.capture()}
                collapsedGroupIds={collapsedGroupIds}
                onExpandGroup={expandGroup}
              >
                <div className="view-editor__grid">
                  <section className="channel-picker" aria-labelledby="available-channel-heading">
                    <div className="workbench-label">
                      <span>02</span>
                      <h2 id="available-channel-heading">AVAILABLE CHANNELS</h2>
                    </div>
                    {availableChannels.length === 0 ? (
                      <div className="panel-empty" aria-live="polite">
                        <p>{emptyStateTitle(channelsEmptyState)}</p>
                        {channelsEmptyDetail !== null && <p>{channelsEmptyDetail}</p>}
                        {channelsEmptyState.kind === 'ember-offline' &&
                          channelsEmptyState.lastError !== null && (
                            <p className="panel-empty__error">{channelsEmptyState.lastError}</p>
                          )}
                        {channelsEmptyState.kind === 'ember-offline' && (
                          <button
                            type="button"
                            className="utility-button"
                            onClick={onOpenConnection}
                          >
                            CONFIGURE CONNECTION
                          </button>
                        )}
                      </div>
                    ) : (
                      <AvailableChannelList
                        channels={availableChannels}
                        assignedChannelIds={assignedChannelIds}
                        duplicateNames={duplicateNames}
                        saving={saving}
                        onToggle={toggleChannel}
                      />
                    )}
                  </section>

                  <section className="channel-order" aria-labelledby="channel-order-heading">
                    <div className="workbench-label channel-order__label">
                      <span>03</span>
                      <h2 id="channel-order-heading">CHANNEL ORDER &amp; COLOR</h2>
                      <small>
                        {pad(activeDraft.channels.length)} ASSIGNED /{' '}
                        {pad(activeDraft.groups.length)} GROUPS
                      </small>
                    </div>
                    <form className="group-toolbar" onSubmit={handleAddGroup}>
                      <label htmlFor="new-group-name">NEW GROUP</label>
                      <div>
                        <input
                          id="new-group-name"
                          value={newGroupName}
                          onChange={(event) => setNewGroupName(event.target.value)}
                          placeholder="Rhythm section"
                          disabled={saving}
                        />
                        <button type="submit" disabled={saving}>
                          ADD GROUP
                        </button>
                      </div>
                    </form>
                    {missingEntries.length > 0 && (
                      <div className="missing-warning" role="status">
                        <div>
                          <strong>{missingEntries.length} MISSING</strong>
                          <span>Clear invalid references, then save the view.</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleCleanup}
                          disabled={saving || !canCleanMissing}
                        >
                          CLEAR INVALID
                        </button>
                      </div>
                    )}
                    <ChannelOrderList
                      listRef={listRef}
                      flipRef={flipRef}
                      view={activeDraft}
                      channels={availableChannels}
                      duplicateNames={duplicateNames}
                      channelInventoryLoaded={channelInventoryLoaded}
                      saving={saving}
                      collapsedGroupIds={collapsedGroupIds}
                      onMoveChannel={handleMoveChannel}
                      onMoveGroup={handleMoveGroup}
                      onAssignGroup={handleAssignGroup}
                      onSetColor={setChannelColor}
                      onRenameGroup={(groupId, name) =>
                        editDraft((source) => renameGroup(source, groupId, name))
                      }
                      onRemoveGroup={(groupId) => {
                        forgetCollapsed(groupId);
                        editDraft((source) => removeGroup(source, groupId));
                      }}
                      onToggleCollapse={toggleCollapse}
                      onSetGroupColor={(groupId, color) =>
                        editDraft((source) => setGroupColor(source, groupId, color))
                      }
                    />
                  </section>
                </div>
              </ViewDndContext>
            </>
          )}
        </section>
      </div>

      <footer className="console-footer">
        <span>VIEW MATRIX / LOCAL CONFIG</span>
        <span>ORDERED SIGNAL SURFACE</span>
        <span>NAME-MATCHED REFERENCES</span>
      </footer>

      {pendingAction !== null && selected !== null && (
        <DiscardChangesDialog
          viewName={selected.name}
          action={pendingAction}
          onDiscard={discardPending}
          onKeepEditing={keepEditing}
        />
      )}
    </main>
  );
}
