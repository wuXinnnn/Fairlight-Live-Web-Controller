import {
  CHANNEL_PALETTE_KEYS,
  type ChannelKind,
  type ChannelPaletteKey,
  type View,
  type ViewChannelRef,
  type ViewGroup,
} from '@flwc/shared';
import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ConnectionStatus } from '../../components/ConnectionStatus.js';
import { createLocalId } from '../../lib/ids.js';
import type { ViewsClient } from '../../lib/views-api.js';
import { mixerStore } from '../../store/mixer-store.js';
import {
  clearViewError,
  createView,
  deleteView,
  updateView,
  viewStore,
} from '../../store/view-store.js';
import { CHANNEL_PALETTE, channelColor, channelTypeColor } from '../mixer/channel-colors.js';
import {
  channelNameKey,
  duplicateChannelNames,
  referenceForChannel,
  resolveViewChannels,
  type ResolvedViewChannel,
} from '../mixer/view-resolver.js';
import { OrderButtons } from './OrderButtons.js';
import {
  addGroup,
  assignGroup,
  moveChannel,
  moveGroup,
  removeGroup,
  renameGroup,
  viewBlocks,
  type MoveDirection,
  type ViewBlock,
} from './view-order.js';

const KIND_LABELS: Record<ChannelKind, string> = {
  channel: 'INPUT',
  main: 'MAIN',
  sub: 'SUB',
  aux: 'AUX',
  mixm: 'MIX MINUS',
  mtx: 'MATRIX',
};

const PALETTE_LABELS: Record<ChannelPaletteKey, string> = {
  green: 'Input Green',
  red: 'Main Red',
  teal: 'Sub Teal',
  navy: 'Aux Navy',
  lime: 'Mix Minus Lime',
  purple: 'Matrix Purple',
};

interface SettingsPageProps {
  viewsClient: ViewsClient;
  onBack(): void;
}

/** Marks the row (channel reference or group) that just moved so it can animate once. */
interface MovedMarker {
  reference?: ViewChannelRef;
  groupId?: string;
  direction: 'up' | 'down';
}

function copyView(view: View): View {
  return {
    ...view,
    channels: view.channels.map((channel) => ({ ...channel })),
    groups: view.groups.map((group) => ({ ...group })),
  };
}

function withColor(reference: ViewChannelRef, color?: ChannelPaletteKey): ViewChannelRef {
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

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function SettingsPage({ viewsClient, onBack }: SettingsPageProps) {
  const { views, saving, error } = useStore(
    viewStore,
    useShallow((state) => ({
      views: state.views,
      saving: state.saving,
      error: state.error,
    })),
  );
  const { channels, channelOrder, channelInventoryLoaded, socketConnected, emberStatus } = useStore(
    mixerStore,
    useShallow((state) => ({
      channels: state.channels,
      channelOrder: state.channelOrder,
      channelInventoryLoaded: state.channelInventoryLoaded,
      socketConnected: state.socketConnected,
      emberStatus: state.emberStatus,
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
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [moved, setMoved] = useState<MovedMarker | null>(null);

  const resolved = useMemo(
    () => (activeDraft === null ? [] : resolveViewChannels(activeDraft, availableChannels)),
    [activeDraft, availableChannels],
  );
  const resolvedByChannelId = useMemo(
    () =>
      new Map(
        resolved
          .filter((entry) => entry.channel !== undefined)
          .map((entry) => [entry.channel?.id ?? '', entry]),
      ),
    [resolved],
  );
  const missingEntries = channelInventoryLoaded
    ? resolved.filter((entry) => entry.channel === undefined)
    : [];
  const canCleanMissing = channelInventoryLoaded && socketConnected && emberStatus === 'connected';

  const selectView = (view: View) => {
    setSelectedId(view.id);
    setDraft(copyView(view));
    setConfirmDelete(false);
    setConfirmCleanup(false);
    setLocalError(null);
    setMoved(null);
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

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) {
      setLocalError('Enter a view name.');
      return;
    }
    setLocalError(null);
    const created = await createView(viewsClient, { name, channels: [], groups: [] });
    if (created !== null) {
      setNewName('');
      selectView(created);
    }
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

  const handleDelete = async () => {
    if (activeDraft === null) {
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const deleted = await deleteView(viewsClient, activeDraft.id);
    if (deleted) {
      setSelectedId(null);
      setDraft(null);
      setConfirmDelete(false);
      setConfirmCleanup(false);
    }
  };

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
    editDraft((source) => {
      const next = moveChannel(source, index, direction);
      if (next !== null) {
        setMoved({
          reference: source.channels[index],
          direction: direction === -1 ? 'up' : 'down',
        });
      }
      return next;
    });
  };

  const handleMoveGroup = (groupId: string, direction: MoveDirection) => {
    editDraft((source) => {
      const next = moveGroup(source, groupId, direction);
      if (next !== null) {
        setMoved({ groupId, direction: direction === -1 ? 'up' : 'down' });
      }
      return next;
    });
  };

  const setChannelColor = (index: number, color?: ChannelPaletteKey) => {
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

  const handleCleanup = async () => {
    if (activeDraft === null || missingEntries.length === 0 || !canCleanMissing) {
      return;
    }
    if (!confirmCleanup) {
      setConfirmCleanup(true);
      return;
    }
    const missingIndexes = new Set(missingEntries.map((entry) => entry.index));
    const updated = await updateView(viewsClient, activeDraft.id, {
      name: activeDraft.name,
      channels: activeDraft.channels.filter((_, index) => !missingIndexes.has(index)),
      groups: activeDraft.groups,
    });
    if (updated !== null) {
      setDraft(copyView(updated));
      setConfirmCleanup(false);
    }
  };

  const renderChannelRow = (entry: ResolvedViewChannel, view: View): ReactNode => {
    const { reference, channel, index } = entry;
    const missing = channelInventoryLoaded && channel === undefined;
    const kind = channel?.kind ?? reference.kind;
    const duplicate =
      channel !== undefined && duplicateNames.has(channelNameKey(channel.kind, channel.name));
    const movedMarker = moved?.reference === reference ? moved.direction : undefined;
    return (
      <li
        key={`${reference.kind}:${reference.name}:${index}`}
        className={`channel-order-row ${missing ? 'is-missing' : ''}`}
        data-ordered-channel-id={channel?.id ?? reference.channelId}
        data-ordered-channel-name={reference.name}
        data-moved={movedMarker}
        onAnimationEnd={() => setMoved(null)}
        style={
          {
            '--channel-row-accent': channelColor(kind, reference.color),
          } as CSSProperties
        }
      >
        <div className="channel-order__index">{pad(index + 1)}</div>
        <span className="channel-order__accent" aria-hidden="true" />
        <div className="channel-order__identity">
          <strong>{channel?.name ?? reference.name}</strong>
          <small>
            {!channelInventoryLoaded ? 'WAITING' : missing ? 'MISSING' : KIND_LABELS[kind]}
            {duplicate && <em className="channel-order__flag">DUPLICATE NAME</em>}
          </small>
        </div>
        <OrderButtons
          label={reference.name}
          canMoveUp={moveChannel(view, index, -1) !== null}
          canMoveDown={moveChannel(view, index, 1) !== null}
          onMove={(direction) => handleMoveChannel(index, direction)}
        />
        <label className="group-control">
          <span>GROUP</span>
          <select
            aria-label={`${reference.name} group`}
            value={reference.groupId ?? ''}
            onChange={(event) =>
              editDraft((source) => assignGroup(source, index, event.target.value || undefined))
            }
          >
            <option value="">NO GROUP</option>
            {view.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <div className="palette-control">
          <button
            type="button"
            className={reference.color === undefined ? 'is-selected' : ''}
            aria-label={`${reference.name} use default color`}
            title="Type default"
            onClick={() => setChannelColor(index)}
          >
            AUTO
          </button>
          {CHANNEL_PALETTE_KEYS.map((color) => (
            <button
              type="button"
              key={color}
              className={reference.color === color ? 'is-selected' : ''}
              aria-label={`${reference.name} color ${PALETTE_LABELS[color]}`}
              title={PALETTE_LABELS[color]}
              style={{ '--swatch': CHANNEL_PALETTE[color] } as CSSProperties}
              onClick={() => setChannelColor(index, color)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </li>
    );
  };

  const renderGroupBlock = (
    group: ViewGroup,
    indices: number[],
    view: View,
    groupNumber: number,
  ): ReactNode => {
    const entries = indices.map((index) => resolved[index]).filter((entry) => entry !== undefined);
    const lead = entries.find((entry) => entry.channel !== undefined) ?? entries[0];
    const accent =
      lead === undefined
        ? channelTypeColor('channel')
        : channelColor(lead.channel?.kind ?? lead.reference.kind, lead.reference.color);
    const presentCount = entries.filter((entry) => entry.channel !== undefined).length;
    return (
      <li
        key={group.id}
        className="view-group"
        data-view-group-id={group.id}
        data-moved={moved?.groupId === group.id ? moved.direction : undefined}
        onAnimationEnd={() => setMoved(null)}
        style={{ '--channel-row-accent': accent } as CSSProperties}
      >
        <div className="view-group__header">
          <div className="channel-order__index">G{pad(groupNumber)}</div>
          <span className="channel-order__accent" aria-hidden="true" />
          <input
            aria-label={`Group ${groupNumber} name`}
            value={group.name}
            onChange={(event) =>
              editDraft((source) => renameGroup(source, group.id, event.target.value))
            }
            disabled={saving}
          />
          <small>{pad(presentCount)} CH</small>
          <OrderButtons
            label={`group ${group.name}`}
            canMoveUp={moveGroup(view, group.id, -1) !== null}
            canMoveDown={moveGroup(view, group.id, 1) !== null}
            onMove={(direction) => handleMoveGroup(group.id, direction)}
          />
          <button
            type="button"
            className="utility-button"
            aria-label={`Ungroup ${group.name}`}
            onClick={() => editDraft((source) => removeGroup(source, group.id))}
            disabled={saving}
          >
            UNGROUP
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="view-group__empty">ASSIGN CHANNELS BELOW</p>
        ) : (
          <ol className="view-group__members">
            {entries.map((entry) => renderChannelRow(entry, view))}
          </ol>
        )}
      </li>
    );
  };

  const renderBlocks = (view: View): ReactNode => {
    let groupNumber = 0;
    return viewBlocks(view).map((block: ViewBlock) => {
      if (block.kind === 'single') {
        const entry = resolved[block.index];
        return entry === undefined ? null : renderChannelRow(entry, view);
      }
      groupNumber += 1;
      return renderGroupBlock(block.group, block.indices, view, groupNumber);
    });
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
        <ConnectionStatus />
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
                  onClick={() => selectView(view)}
                >
                  <span>{pad(index + 1)}</span>
                  <strong>{view.name}</strong>
                  <small>{pad(view.channels.length)} CH</small>
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
                    className="primary-button"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'SAVING' : 'SAVE VIEW'}
                  </button>
                </div>
              </header>

              <div className="view-editor__grid">
                <section className="channel-picker" aria-labelledby="available-channel-heading">
                  <div className="workbench-label">
                    <span>02</span>
                    <h2 id="available-channel-heading">AVAILABLE CHANNELS</h2>
                  </div>
                  {availableChannels.length === 0 ? (
                    <p className="panel-empty">WAITING FOR MIXER SNAPSHOT</p>
                  ) : (
                    <div className="channel-checklist">
                      {availableChannels.map((channel) => {
                        const checked = resolvedByChannelId.has(channel.id);
                        const duplicate = duplicateNames.has(
                          channelNameKey(channel.kind, channel.name),
                        );
                        return (
                          <label
                            key={channel.id}
                            className={checked ? 'is-checked' : ''}
                            data-available-channel-id={channel.id}
                            style={
                              {
                                '--channel-row-accent': channelTypeColor(channel.kind),
                              } as CSSProperties
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleChannel(channel.id)}
                            />
                            <span className="channel-checklist__box" aria-hidden="true" />
                            <span className="channel-checklist__accent" aria-hidden="true" />
                            <strong>{channel.name}</strong>
                            <small>
                              {KIND_LABELS[channel.kind]}
                              {duplicate && <em className="channel-order__flag">DUPLICATE NAME</em>}
                            </small>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="channel-order" aria-labelledby="channel-order-heading">
                  <div className="workbench-label channel-order__label">
                    <span>03</span>
                    <h2 id="channel-order-heading">CHANNEL ORDER &amp; COLOR</h2>
                    <small>
                      {pad(activeDraft.channels.length)} ASSIGNED / {pad(activeDraft.groups.length)}{' '}
                      GROUPS
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
                        <span>References are preserved until you clear them.</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCleanup}
                        disabled={saving || !canCleanMissing}
                      >
                        {confirmCleanup ? 'CONFIRM CLEAR' : 'CLEAR INVALID'}
                      </button>
                    </div>
                  )}
                  {activeDraft.channels.length === 0 && activeDraft.groups.length === 0 ? (
                    <p className="panel-empty">THIS VIEW HAS NO CHANNELS</p>
                  ) : (
                    <ol className="view-channel-list">{renderBlocks(activeDraft)}</ol>
                  )}
                </section>
              </div>
            </>
          )}
        </section>
      </div>

      <footer className="console-footer">
        <span>VIEW MATRIX / LOCAL CONFIG</span>
        <span>ORDERED SIGNAL SURFACE</span>
        <span>NAME-MATCHED REFERENCES</span>
      </footer>
    </main>
  );
}
