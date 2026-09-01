import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LocalWorkspaceFileSystem,
  enrichWorkspaceMediaEvent,
  WorkspaceArtifactBridge,
  WorkspaceMediaError,
  WorkspaceMediaTracker,
  markdownWorkspaceMediaPaths,
} from './workspace-media.js';

const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><circle cx="50" cy="25" r="20" /></svg>';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-workspace-media-'));
  const cwd = join(root, 'workspace');
  const spoolDir = join(root, 'spool');
    mkdirSync(cwd);
    mkdirSync(spoolDir);
    const bridge = new WorkspaceArtifactBridge({
      secret: 'node-secret-for-tests',
      fileSystem: new LocalWorkspaceFileSystem(),
      spoolDir,
    });
    bridge.setSessionCwdResolver((sessionId) => sessionId === 'session-1' || sessionId === 's' ? cwd : undefined);
    return {
      root,
      cwd,
      spoolDir,
      bridge,
    };
}

describe('workspace media discovery', () => {
  it('correlates a successful write result with its media path', () => {
    const tracker = new WorkspaceMediaTracker();
    tracker.observe({
      seq: 1,
      time: 1,
      type: 'tool/call',
      data: { callId: 'call-1', name: 'write', arguments: { file_path: 'art/mickey.svg', content: SAFE_SVG } },
    });
    expect(tracker.mediaPathsFor({
      seq: 2,
      time: 2,
      type: 'tool/result',
      data: { message: { content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: '<path>art/mickey.svg</path>\nCreated file' }] }] } },
    })).toEqual([{ path: 'art/mickey.svg', source: 'tool' }]);
  });

  it('ignores failed tools and arbitrary paths in prose', () => {
    const tracker = new WorkspaceMediaTracker();
    tracker.observe({
      seq: 1,
      time: 1,
      type: 'tool/call',
      data: { callId: 'call-1', name: 'write', arguments: { file_path: 'private.svg', content: SAFE_SVG } },
    });
    expect(tracker.mediaPathsFor({
      seq: 2,
      time: 2,
      type: 'tool/result',
      data: { error: true, message: { content: [{ type: 'tool-result', toolCallId: 'call-1', isError: true }] } },
    })).toEqual([]);
    expect(markdownWorkspaceMediaPaths('The file is at secrets/private.svg')).toEqual([]);
  });

  it('extracts only explicit relative Markdown media links', () => {
    expect(markdownWorkspaceMediaPaths([
      '![Mickey](art/mickey.svg)',
      '![Photo](<art/my photo.png>)',
      '![Remote](https://example.com/chart.svg)',
      '![Outside](../secret.png)',
      '![Code](src/main.ts)',
    ].join('\n'))).toEqual(['art/mickey.svg', 'art/my photo.png']);
  });

  it('accepts media paths from structured mutation presentation metadata', () => {
    const tracker = new WorkspaceMediaTracker();
    tracker.observe({
      type: 'tool/call',
      data: {
        callId: 'call-presented',
        name: 'asset_generator',
        arguments: '{}',
        presentation: {
          card: 'generic',
          kind: 'edit',
          locations: [{ path: 'art/generated.png' }, { path: '../outside.png' }],
        },
      },
    });
    expect(tracker.mediaPathsFor({
      type: 'tool/result',
      data: { message: { content: [{ type: 'tool-result', toolCallId: 'call-presented', content: [] }] } },
    })).toEqual([{ path: 'art/generated.png', source: 'tool' }]);
  });
});

describe('workspace artifact bridge', () => {
  it('adds a verified workspace-media block to the matching tool result event', async () => {
    const value = fixture();
    mkdirSync(join(value.cwd, 'art'));
    writeFileSync(join(value.cwd, 'art', 'mickey.svg'), SAFE_SVG);
    const tracker = new WorkspaceMediaTracker();
    await enrichWorkspaceMediaEvent({
      tracker,
      bridge: value.bridge,
      sessionId: 'session-1',
      cwd: value.cwd,
      source: {
        seq: 1, time: 1, type: 'tool/call',
        data: { callId: 'call-1', name: 'write', arguments: { file_path: 'art/mickey.svg', content: SAFE_SVG } },
      },
      canonical: { sourceSeq: 1, createdAt: 1, event: { type: 'tool.call', data: { toolCallId: 'call-1' } } },
    });
    const enriched = await enrichWorkspaceMediaEvent({
      tracker,
      bridge: value.bridge,
      sessionId: 'session-1',
      cwd: value.cwd,
      source: {
        seq: 2, time: 2, type: 'tool/result',
        data: { message: { content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] } },
      },
      canonical: { sourceSeq: 2, createdAt: 2, event: { type: 'tool.result', data: { toolCallId: 'call-1' } } },
    });
    expect(enriched.event.data.blocks).toEqual([
      expect.objectContaining({ type: 'workspace-media', path: 'art/mickey.svg', source: 'tool' }),
    ]);
  });

  it('does not emit the same file version again when the assistant also links it', async () => {
    const value = fixture();
    mkdirSync(join(value.cwd, 'art'));
    writeFileSync(join(value.cwd, 'art', 'mickey.svg'), SAFE_SVG);
    const tracker = new WorkspaceMediaTracker();
    await enrichWorkspaceMediaEvent({
      tracker, bridge: value.bridge, sessionId: 'session-1', cwd: value.cwd,
      source: { type: 'tool/call', data: { callId: 'call-1', name: 'write', arguments: { file_path: 'art/mickey.svg' } } },
      canonical: { sourceSeq: 1, createdAt: 1, event: { type: 'tool.call', data: {} } },
    });
    const tool = await enrichWorkspaceMediaEvent({
      tracker, bridge: value.bridge, sessionId: 'session-1', cwd: value.cwd,
      source: { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] } } },
      canonical: { sourceSeq: 2, createdAt: 2, event: { type: 'tool.result', data: {} } },
    });
    const assistant = await enrichWorkspaceMediaEvent({
      tracker, bridge: value.bridge, sessionId: 'session-1', cwd: value.cwd,
      source: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '![Mickey](art/mickey.svg)' }] } } },
      canonical: { sourceSeq: 3, createdAt: 3, event: { type: 'assistant.message', data: { text: '![Mickey](art/mickey.svg)' } } },
    });

    expect(tool.event.data.blocks).toHaveLength(1);
    expect(assistant.event.data.blocks).toBeUndefined();
    expect(assistant.event.data.suppressedWorkspaceMediaPaths).toEqual(['art/mickey.svg']);
  });

  it('creates a signed session-bound SVG block and exports the verified bytes', async () => {
    const value = fixture();
    mkdirSync(join(value.cwd, 'art'));
    writeFileSync(join(value.cwd, 'art', 'mickey.svg'), SAFE_SVG);

    const block = await value.bridge.inspect({
      sessionId: 'session-1',
      cwd: value.cwd,
      path: 'art/mickey.svg',
      source: 'tool',
    });
    expect(block).toMatchObject({
      type: 'workspace-media',
      mediaType: 'image/svg+xml',
      bytes: Buffer.byteLength(SAFE_SVG),
      name: 'mickey.svg',
      path: 'art/mickey.svg',
      source: 'tool',
    });

    const exported = await value.bridge.export('session-1', block.artifactId);
    expect(exported.artifact).toMatchObject({ mediaType: 'image/svg+xml', bytes: Buffer.byteLength(SAFE_SVG) });
    expect(readFileSync(join(value.spoolDir, `${exported.exportToken}.artifact`), 'utf8')).toBe(SAFE_SVG);
    await expect(value.bridge.export('session-2', block.artifactId)).rejects.toMatchObject<Partial<WorkspaceMediaError>>({ code: 'ARTIFACT_FORBIDDEN' });
  });

  it('rejects traversal, symlinks, spoofed raster files and active SVG', async () => {
    const value = fixture();
    writeFileSync(join(value.root, 'outside.svg'), SAFE_SVG);
    symlinkSync(join(value.root, 'outside.svg'), join(value.cwd, 'linked.svg'));
    writeFileSync(join(value.cwd, 'spoofed.png'), SAFE_SVG);
    writeFileSync(join(value.cwd, 'active.svg'), '<svg onload="alert(1)"><script>alert(1)</script></svg>');

    await expect(value.bridge.inspect({ sessionId: 's', cwd: value.cwd, path: '../outside.svg', source: 'tool' })).rejects.toMatchObject<Partial<WorkspaceMediaError>>({ code: 'ARTIFACT_PATH_INVALID' });
    await expect(value.bridge.inspect({ sessionId: 's', cwd: value.cwd, path: 'linked.svg', source: 'tool' })).rejects.toMatchObject<Partial<WorkspaceMediaError>>({ code: 'ARTIFACT_PATH_INVALID' });
    await expect(value.bridge.inspect({ sessionId: 's', cwd: value.cwd, path: 'spoofed.png', source: 'tool' })).rejects.toMatchObject<Partial<WorkspaceMediaError>>({ code: 'ARTIFACT_MEDIA_INVALID' });
    await expect(value.bridge.inspect({ sessionId: 's', cwd: value.cwd, path: 'active.svg', source: 'tool' })).rejects.toMatchObject<Partial<WorkspaceMediaError>>({ code: 'ARTIFACT_MEDIA_INVALID' });
  });

  it('refuses to export a file that changed after its message was created', async () => {
    const value = fixture();
    writeFileSync(join(value.cwd, 'chart.svg'), SAFE_SVG);
    const block = await value.bridge.inspect({ sessionId: 'session-1', cwd: value.cwd, path: 'chart.svg', source: 'tool' });
    writeFileSync(join(value.cwd, 'chart.svg'), SAFE_SVG.replace('r="20"', 'r="21"'));
    await expect(value.bridge.export('session-1', block.artifactId)).rejects.toMatchObject<Partial<WorkspaceMediaError>>({ code: 'ARTIFACT_CHANGED' });
  });
});
