import { Model } from 'emberplus-connection';
import { describe, expect, it, vi } from 'vitest';
import {
  attachMissingMixerStrips,
  discoverMixerStripRefs,
  expandEmberTree,
  ghostMixerChildKeys,
  hasGhostMixerChildren,
  hasIncompleteMixerStrips,
  incompleteMixerStripKeys,
  listMixerStripRefs,
  mixerGapKeys,
  PROBE_SETTLE_MS,
  STRIP_DIRECTORY_TIMEOUT_MS,
  STRIP_STUB_DIRECTORY_TIMEOUT_MS,
  withTimeout,
} from './expand-ember-tree.js';
import type { EmberDirectoryRequest, EmberTreeClient } from './expand-ember-tree.js';

function node(
  number: number,
  contents: Model.EmberElement,
  children?: { [index: number]: Model.NumberedTreeNode<Model.EmberElement> },
): Model.NumberedTreeNode<Model.EmberElement> {
  return new Model.NumberedTreeNodeImpl(number, contents, children);
}

/** A strip with the three parameters the mixer page needs, so it counts as fully read. */
function completeStrip(
  number: number,
  identifier: string,
): Model.NumberedTreeNode<Model.EmberElement> {
  return node(number, new Model.EmberNodeImpl(identifier), {
    1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
    2: node(2, new Model.ParameterImpl(Model.ParameterType.Boolean, 'mute', undefined, false)),
    3: node(3, new Model.ParameterImpl(Model.ParameterType.String, 'name', undefined, identifier)),
  });
}

describe('withTimeout', () => {
  it('rejects when the promise does not settle in time', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, 'hang')).rejects.toThrow(
      'Timeout after 10ms: hang',
    );
  });
});

describe('expandEmberTree', () => {
  it('records a failed node and continues expanding siblings', async () => {
    const goodChild = node(2, new Model.EmberNodeImpl('ok'));
    const badChild = node(1, new Model.EmberNodeImpl('bad'));
    const root = node(1, new Model.EmberNodeImpl('root'), { 1: badChild, 2: goodChild });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async (target): Promise<EmberDirectoryRequest> => {
        if (target === badChild) {
          throw new Error('provider timeout');
        }
        if (target === goodChild) {
          goodChild.children = {
            1: node(
              1,
              new Model.ParameterImpl(Model.ParameterType.Boolean, 'mute', undefined, false),
            ),
          };
        }
        return { response: Promise.resolve(target) };
      }),
    };

    const { errors } = await expandEmberTree(client);
    expect(errors).toEqual([{ path: 'root/bad', message: 'provider timeout' }]);
    expect(goodChild.children?.[1]?.contents).toMatchObject({ identifier: 'mute' });
    expect(client.getDirectory).toHaveBeenCalled();
  });

  it('expands an empty root collection first', async () => {
    const tree: EmberTreeClient['tree'] = {};
    const client: EmberTreeClient = {
      tree,
      getDirectory: vi.fn(async () => {
        Object.assign(tree, {
          1: node(1, new Model.EmberNodeImpl('system'), {
            1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'integrated')),
          }),
        });
        return { response: Promise.resolve(undefined) };
      }),
    };

    const { errors } = await expandEmberTree(client);
    expect(errors).toEqual([]);
    expect(Object.keys(tree)).toEqual(['1']);
  });

  it('skips identifiers such as sends without calling getDirectory', async () => {
    const sends = node(11, new Model.EmberNodeImpl('sends'));
    const root = node(1, new Model.EmberNodeImpl('ch'), { 11: sends });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client, { skipIdentifiers: ['sends'] });
    expect(client.getDirectory).not.toHaveBeenCalled();
  });

  it('does not call getDirectory on parameters', async () => {
    const parameter = node(
      1,
      new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -3),
    );
    const root = node(1, new Model.EmberNodeImpl('ch'), { 1: parameter });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).not.toHaveBeenCalled();
  });

  it('getDirectory on strip-like nodes that have an empty children object', async () => {
    const strip = node(1, new Model.EmberNodeImpl('channel2'), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: strip });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async (target): Promise<EmberDirectoryRequest> => {
        if (target === strip) {
          strip.children = {
            1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
          };
        }
        return { response: Promise.resolve(target) };
      }),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).toHaveBeenCalledWith(strip);
    expect(strip.children?.[1]?.contents).toMatchObject({ identifier: 'level' });
  });

  it('clears an empty children object on a strip before getDirectory', async () => {
    const strip = node(1, new Model.EmberNodeImpl('channel2'), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: strip });
    let seenChildren: unknown;
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async (target): Promise<EmberDirectoryRequest> => {
        if (target === strip) {
          seenChildren = strip.children;
        }
        return { response: Promise.resolve(target) };
      }),
    };

    await expandEmberTree(client);
    expect(seenChildren).toBeUndefined();
  });

  it('getDirectory an unidentified empty child under a mixer bus', async () => {
    const ghost = node(2, new Model.EmberNodeImpl(), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 2: ghost });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).toHaveBeenCalledWith(ghost);
  });

  it('gives a named strip two seconds and a ghost 400 ms', async () => {
    vi.useFakeTimers();
    try {
      const strip = node(1, new Model.EmberNodeImpl('channel1'));
      const ghost = node(2, new Model.EmberNodeImpl(), {});
      const root = node(1, new Model.EmberNodeImpl('channel'), { 1: strip, 2: ghost });
      const client: EmberTreeClient = {
        tree: { 1: root },
        getDirectory: vi.fn(() => new Promise<EmberDirectoryRequest>(() => undefined)),
      };
      const expanding = expandEmberTree(client, { timeoutMs: 10_000 });
      await vi.advanceTimersByTimeAsync(
        STRIP_DIRECTORY_TIMEOUT_MS + STRIP_STUB_DIRECTORY_TIMEOUT_MS,
      );
      const { errors } = await expanding;
      expect(errors).toEqual([
        {
          path: 'channel/channel1',
          message: `Timeout after ${STRIP_DIRECTORY_TIMEOUT_MS}ms: getDirectory channel/channel1`,
        },
        {
          path: 'channel/2',
          message: `Timeout after ${STRIP_STUB_DIRECTORY_TIMEOUT_MS}ms: getDirectory channel/2`,
        },
      ]);
      expect(strip.children).toEqual({});
      expect(ghost.children).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets stripDirectoryTimeoutMs override the named strip timeout but not the ghost one', async () => {
    vi.useFakeTimers();
    try {
      const strip = node(1, new Model.EmberNodeImpl('channel1'));
      const ghost = node(2, new Model.EmberNodeImpl(), {});
      const root = node(1, new Model.EmberNodeImpl('channel'), { 1: strip, 2: ghost });
      const client: EmberTreeClient = {
        tree: { 1: root },
        getDirectory: vi.fn(() => new Promise<EmberDirectoryRequest>(() => undefined)),
      };
      const expanding = expandEmberTree(client, { timeoutMs: 10_000, stripDirectoryTimeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(50 + STRIP_STUB_DIRECTORY_TIMEOUT_MS);
      const { errors } = await expanding;
      expect(errors.map((error) => error.message)).toEqual([
        'Timeout after 50ms: getDirectory channel/channel1',
        `Timeout after ${STRIP_STUB_DIRECTORY_TIMEOUT_MS}ms: getDirectory channel/2`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out unidentified mixer-bus ghosts as stubs and restores empty children', async () => {
    const ghost = node(2, new Model.EmberNodeImpl(), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 2: ghost });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(() => new Promise<EmberDirectoryRequest>(() => undefined)),
    };

    const started = Date.now();
    const { errors } = await expandEmberTree(client, { timeoutMs: 2_000 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(errors).toEqual([
      {
        path: 'channel/2',
        message: `Timeout after ${STRIP_STUB_DIRECTORY_TIMEOUT_MS}ms: getDirectory channel/2`,
      },
    ]);
    expect(ghost.children).toEqual({});
  });

  it('does not getDirectory on an already expanded bus root', async () => {
    const strip = node(1, new Model.EmberNodeImpl('channel1'), {
      1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
    });
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: strip });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).not.toHaveBeenCalled();
  });

  it('does not getDirectory on a bus root with empty children', async () => {
    const root = node(1, new Model.EmberNodeImpl('channel'), {});
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).not.toHaveBeenCalled();
  });
});

describe('incomplete mixer strips', () => {
  it('reports online strips that are missing required parameters', () => {
    const complete = node(1, new Model.EmberNodeImpl('channel1'), {
      1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
      2: node(2, new Model.ParameterImpl(Model.ParameterType.Boolean, 'mute', undefined, false)),
      4: node(4, new Model.ParameterImpl(Model.ParameterType.String, 'name', undefined, 'BASS')),
    });
    const stub = node(2, new Model.EmberNodeImpl('channel2'), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: complete, 2: stub });
    const tree = { 1: root };
    expect(hasIncompleteMixerStrips(tree)).toBe(true);
    expect(incompleteMixerStripKeys(tree)).toEqual(['channel/channel2']);
  });

  it('ignores offline stubs and complete strips', () => {
    const complete = node(1, new Model.EmberNodeImpl('channel1'), {
      1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
      2: node(2, new Model.ParameterImpl(Model.ParameterType.Boolean, 'mute', undefined, false)),
      4: node(4, new Model.ParameterImpl(Model.ParameterType.String, 'name', undefined, 'BASS')),
    });
    const offline = node(2, new Model.EmberNodeImpl('channel2', undefined, true, false), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: complete, 2: offline });
    expect(hasIncompleteMixerStrips({ 1: root })).toBe(false);
  });
});

describe('ghost mixer children', () => {
  it('reports an online child without an identifier under an online mixer bus', () => {
    const ghost = node(2, new Model.EmberNodeImpl(), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), {
      1: node(1, new Model.EmberNodeImpl('channel1')),
      2: ghost,
    });
    expect(hasGhostMixerChildren({ 1: root })).toBe(true);
  });

  it('ignores offline ghosts, identified strips, and roots that are not mixer buses', () => {
    const offlineGhost = node(
      2,
      new Model.EmberNodeImpl(undefined, undefined, undefined, false),
      {},
    );
    const channel = node(1, new Model.EmberNodeImpl('channel'), {
      1: node(1, new Model.EmberNodeImpl('channel1')),
      2: offlineGhost,
    });
    const system = node(0, new Model.EmberNodeImpl('system'), {
      1: node(1, new Model.EmberNodeImpl(), {}),
    });
    const offlineBus = node(3, new Model.EmberNodeImpl('aux', undefined, undefined, false), {
      1: node(1, new Model.EmberNodeImpl(), {}),
    });
    expect(hasGhostMixerChildren({ 0: system, 1: channel, 3: offlineBus })).toBe(false);
    expect(hasGhostMixerChildren({})).toBe(false);
  });

  it('keys every gap a probe is for: ghosts by number, incomplete strips by identifier', () => {
    const channel = node(1, new Model.EmberNodeImpl('channel'), {
      1: node(1, new Model.EmberNodeImpl('channel1'), {
        1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
        2: node(2, new Model.ParameterImpl(Model.ParameterType.Boolean, 'mute', undefined, false)),
        4: node(4, new Model.ParameterImpl(Model.ParameterType.String, 'name', undefined, 'MIC')),
      }),
      2: node(2, new Model.EmberNodeImpl('channel2'), {}),
      7: node(7, new Model.EmberNodeImpl(), {}),
    });
    const aux = node(3, new Model.EmberNodeImpl('aux'), {
      9: node(9, new Model.EmberNodeImpl(), {}),
    });
    expect(ghostMixerChildKeys({ 1: channel, 3: aux })).toEqual(['channel#7', 'aux#9']);
    expect(mixerGapKeys({ 1: channel, 3: aux })).toEqual([
      'ghost:channel#7',
      'ghost:aux#9',
      'incomplete:channel/channel2',
    ]);
    expect(mixerGapKeys({})).toEqual([]);
  });
});

describe('mixer strip discovery', () => {
  it('waits for trailing directory packets before listing the strips', async () => {
    vi.useFakeTimers();
    try {
      const first = node(1, new Model.EmberNodeImpl('channel1'));
      const second = node(2, new Model.EmberNodeImpl('channel2'));
      const root = node(1, new Model.EmberNodeImpl('channel'));
      const client: EmberTreeClient = {
        tree: { 1: root },
        getDirectory: vi.fn(async (): Promise<EmberDirectoryRequest> => {
          // The library resolves on the first packet with children; the second packet lands later.
          root.children = { 1: first };
          setTimeout(() => {
            root.children = { 1: first, 2: second };
          }, PROBE_SETTLE_MS / 2);
          return { response: Promise.resolve(root) };
        }),
      };
      const discovering = discoverMixerStripRefs(client, { timeoutMs: 1_000 });
      await vi.advanceTimersByTimeAsync(PROBE_SETTLE_MS - 1);
      let settled = false;
      void discovering.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const { refs } = await discovering;
      expect(refs.map((ref) => ref.identifier)).toEqual(['channel1', 'channel2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists strip refs from an already expanded tree', () => {
    const root = node(1, new Model.EmberNodeImpl('channel'), {
      1: node(1, new Model.EmberNodeImpl('channel1')),
      2: node(2, new Model.EmberNodeImpl('channel2')),
    });
    expect(listMixerStripRefs({ 1: root })).toEqual([
      { bus: 'channel', number: 1, identifier: 'channel1' },
      { bus: 'channel', number: 2, identifier: 'channel2' },
    ]);
  });

  it('getDirectory mixer bus roots on a fresh tree and lists the strips', async () => {
    const strip = node(2, new Model.EmberNodeImpl('channel2'));
    const root = node(1, new Model.EmberNodeImpl('channel'));
    const tree: EmberTreeClient['tree'] = {};
    const client: EmberTreeClient = {
      tree,
      getDirectory: vi.fn(async (target): Promise<EmberDirectoryRequest> => {
        if (target === tree) {
          Object.assign(tree, { 1: root });
        }
        if (target === root) {
          root.children = { 2: strip };
        }
        return { response: Promise.resolve(target) };
      }),
    };
    const { refs, errors } = await discoverMixerStripRefs(client);
    expect(errors).toEqual([]);
    expect(refs).toEqual([{ bus: 'channel', number: 2, identifier: 'channel2' }]);
    expect(client.getDirectory).toHaveBeenCalledTimes(2);
  });

  it('attaches missing strip stubs without replacing existing children', () => {
    const existing = completeStrip(1, 'channel1');
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: existing });
    const tree = { 1: root };
    const added = attachMissingMixerStrips(tree, [
      { bus: 'channel', number: 1, identifier: 'channel1' },
      { bus: 'channel', number: 2, identifier: 'channel2' },
    ]);
    expect(added).toEqual([{ bus: 'channel', number: 2, identifier: 'channel2' }]);
    expect(root.children?.[1]).toBe(existing);
    expect(root.children?.[1]?.children).toBe(existing.children);
    expect(root.children?.[2]?.contents).toMatchObject({ identifier: 'channel2' });
  });

  it('clears a known strip that is online but still without its parameters, so it is read again', () => {
    const incomplete = node(1, new Model.EmberNodeImpl('channel1'), {});
    const offline = node(2, new Model.EmberNodeImpl('channel2', undefined, undefined, false), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: incomplete, 2: offline });
    const tree = { 1: root };
    const added = attachMissingMixerStrips(tree, [
      { bus: 'channel', number: 1, identifier: 'channel1' },
      { bus: 'channel', number: 2, identifier: 'channel2' },
    ]);
    // The stub stays the same node; only its empty children go, so the next expansion asks again.
    expect(added).toEqual([{ bus: 'channel', number: 1, identifier: 'channel1' }]);
    expect(root.children?.[1]).toBe(incomplete);
    expect(incomplete.children).toBeUndefined();
    // An offline strip cannot be expanded, so there is no point clearing it.
    expect(offline.children).toEqual({});
  });

  it('replaces an unidentified ghost occupant at the new strip number', () => {
    const existing = node(1, new Model.EmberNodeImpl('channel1'));
    const ghost = node(2, new Model.EmberNodeImpl(), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: existing, 2: ghost });
    const tree = { 1: root };
    const added = attachMissingMixerStrips(tree, [
      { bus: 'channel', number: 2, identifier: 'channel2' },
    ]);
    expect(added).toEqual([{ bus: 'channel', number: 2, identifier: 'channel2' }]);
    expect(root.children?.[2]).not.toBe(ghost);
    expect(root.children?.[2]?.contents).toMatchObject({ identifier: 'channel2' });
    expect(root.children?.[2]?.children).toBeUndefined();
  });
});
