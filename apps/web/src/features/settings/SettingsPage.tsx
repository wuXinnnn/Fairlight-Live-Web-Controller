import {
  CHANNEL_KINDS,
  CHANNEL_PALETTE_KEYS,
  type ChannelKind,
  type ChannelPaletteKey,
  type View,
  type ViewChannelRef,
} from '@flwc/shared';
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ConnectionStatus } from '../../components/ConnectionStatus.js';
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

function copyView(view: View): View {
  return {
    ...view,
    channels: view.channels.map((channel) => ({ ...channel })),
  };
}

function kindFromChannelId(channelId: string): ChannelKind {
  const prefix = channelId.split('/')[0];
  return CHANNEL_KINDS.find((kind) => kind === prefix) ?? 'channel';
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
  const { channels, channelOrder } = useStore(
    mixerStore,
    useShallow((state) => ({
      channels: state.channels,
      channelOrder: state.channelOrder,
    })),
  );
  const availableChannels = useMemo(
    () => channelOrder.map((id) => channels[id]).filter((channel) => channel !== undefined),
    [channelOrder, channels],
  );
  const [selectedId, setSelectedId] = useState<string | null>(views[0]?.id ?? null);
  const selected = views.find((view) => view.id === selectedId) ?? views[0] ?? null;
  const [draft, setDraft] = useState<View | null>(null);
  const activeDraft = draft?.id === selected?.id ? draft : selected;
  const [newName, setNewName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  const selectView = (view: View) => {
    setSelectedId(view.id);
    setDraft(copyView(view));
    setConfirmDelete(false);
    setConfirmCleanup(false);
    setLocalError(null);
  };

  const missingChannels =
    activeDraft?.channels.filter((channel) => channels[channel.channelId] === undefined) ?? [];

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) {
      setLocalError('Enter a view name.');
      return;
    }
    setLocalError(null);
    const created = await createView(viewsClient, { name, channels: [] });
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
    setLocalError(null);
    const updated = await updateView(viewsClient, activeDraft.id, {
      name,
      channels: activeDraft.channels,
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
    setDraft((current) => {
      const source = current?.id === activeDraft?.id ? current : activeDraft;
      if (source === null) {
        return current;
      }
      const exists = source.channels.some((channel) => channel.channelId === channelId);
      const channel = channels[channelId];
      return {
        ...source,
        channels: exists
          ? source.channels.filter((candidate) => candidate.channelId !== channelId)
          : [
              ...source.channels,
              {
                channelId,
                lastKnownName: channel?.name ?? channelId,
              },
            ],
      };
    });
  };

  const moveChannel = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const source = current?.id === activeDraft?.id ? current : activeDraft;
      if (source === null) {
        return current;
      }
      const target = index + direction;
      if (target < 0 || target >= source.channels.length) {
        return source;
      }
      const next = [...source.channels];
      [next[index], next[target]] = [next[target] as ViewChannelRef, next[index] as ViewChannelRef];
      return { ...source, channels: next };
    });
  };

  const setChannelColor = (index: number, color?: ChannelPaletteKey) => {
    setDraft((current) => {
      const source = current?.id === activeDraft?.id ? current : activeDraft;
      if (source === null) {
        return current;
      }
      const next = source.channels.map((channel, candidateIndex) => {
        if (candidateIndex !== index) {
          return channel;
        }
        if (color === undefined) {
          return {
            channelId: channel.channelId,
            lastKnownName: channel.lastKnownName,
          };
        }
        return { ...channel, color };
      });
      return { ...source, channels: next };
    });
  };

  const handleCleanup = async () => {
    if (activeDraft === null || missingChannels.length === 0) {
      return;
    }
    if (!confirmCleanup) {
      setConfirmCleanup(true);
      return;
    }
    const validChannels = activeDraft.channels.filter(
      (channel) => channels[channel.channelId] !== undefined,
    );
    const updated = await updateView(viewsClient, activeDraft.id, {
      name: activeDraft.name,
      channels: validChannels,
    });
    if (updated !== null) {
      setDraft(copyView(updated));
      setConfirmCleanup(false);
    }
  };

  return (
    <main className="mixer-shell settings-shell" data-theme="dark">
      <header className="console-header settings-header">
        <div className="console-brand">
          <span className="console-brand__eyebrow">FAIRLIGHT LIVE</span>
          <h1>VIEW CONFIGURATION</h1>
        </div>
        <ConnectionStatus />
        <div className="console-navigation">
          <span>WORKSPACE</span>
          <button type="button" onClick={onBack}>
            RETURN TO MIXER
          </button>
        </div>
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
                  <span>{(index + 1).toString().padStart(2, '0')}</span>
                  <strong>{view.name}</strong>
                  <small>{view.channels.length.toString().padStart(2, '0')} CH</small>
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
                        const checked = activeDraft.channels.some(
                          (candidate) => candidate.channelId === channel.id,
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
                            <small>{KIND_LABELS[channel.kind]}</small>
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
                      {activeDraft.channels.length.toString().padStart(2, '0')} ASSIGNED
                    </small>
                  </div>
                  {missingChannels.length > 0 && (
                    <div className="missing-warning" role="status">
                      <div>
                        <strong>{missingChannels.length} MISSING</strong>
                        <span>References are preserved until you clear them.</span>
                      </div>
                      <button type="button" onClick={handleCleanup} disabled={saving}>
                        {confirmCleanup ? 'CONFIRM CLEAR' : 'CLEAR INVALID'}
                      </button>
                    </div>
                  )}
                  {activeDraft.channels.length === 0 ? (
                    <p className="panel-empty">THIS VIEW HAS NO CHANNELS</p>
                  ) : (
                    <ol className="view-channel-list">
                      {activeDraft.channels.map((reference, index) => {
                        const channel = channels[reference.channelId];
                        const missing = channel === undefined;
                        const kind = channel?.kind ?? kindFromChannelId(reference.channelId);
                        return (
                          <li
                            key={reference.channelId}
                            className={missing ? 'is-missing' : ''}
                            data-ordered-channel-id={reference.channelId}
                            style={
                              {
                                '--channel-row-accent': channelColor(kind, reference.color),
                              } as CSSProperties
                            }
                          >
                            <div className="channel-order__index">
                              {(index + 1).toString().padStart(2, '0')}
                            </div>
                            <span className="channel-order__accent" aria-hidden="true" />
                            <div className="channel-order__identity">
                              <strong>{channel?.name ?? reference.lastKnownName}</strong>
                              <small>{missing ? 'MISSING' : KIND_LABELS[channel.kind]}</small>
                            </div>
                            <div
                              className="order-buttons"
                              aria-label={`${reference.lastKnownName} order`}
                            >
                              <button
                                type="button"
                                aria-label={`Move ${reference.lastKnownName} up`}
                                onClick={() => moveChannel(index, -1)}
                                disabled={index === 0}
                              >
                                UP
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${reference.lastKnownName} down`}
                                onClick={() => moveChannel(index, 1)}
                                disabled={index === activeDraft.channels.length - 1}
                              >
                                DN
                              </button>
                            </div>
                            <div className="palette-control">
                              <button
                                type="button"
                                className={reference.color === undefined ? 'is-selected' : ''}
                                aria-label={`${reference.lastKnownName} use default color`}
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
                                  aria-label={`${reference.lastKnownName} color ${PALETTE_LABELS[color]}`}
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
                      })}
                    </ol>
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
        <span>EMBER+ REFERENCES</span>
      </footer>
    </main>
  );
}
