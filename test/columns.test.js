import test from 'node:test';
import assert from 'node:assert/strict';
import { buildColumnCatalog, inferFogBugzishType } from '../index.js';

test('buildColumnCatalog: falls back to curated core columns when metadata commands fail', async () => {
  // Arrange
  const callFn = async () => {
    throw new Error('unsupported cmd');
  };

  // Assert (initial)
  assert.equal(typeof callFn, 'function');

  // Act
  const result = await buildColumnCatalog({}, { callFn });

  // Assert
  assert.equal(result.strategy, 'fallback');
  assert.equal(result.coverage, 'partial');
  assert.equal(result.ixBug, null);
  assert.ok(result.columns.length > 0);
  assert.ok(result.columns.some((item) => item.id === 'ixBug'));
  assert.ok(result.warnings.some((item) => item.includes('Falling back to curated core columns')));
  assert.ok(result.warnings.some((item) => item.includes('Custom columns are case-scoped')));
});

test('buildColumnCatalog: includes custom columns when ixBug is provided', async () => {
  // Arrange
  const callFn = async (payload) => {
    if (payload.cmd === 'search') {
      return {
        cases: {
          case: {
            ixBug: String(payload.q),
            plugin_customfield: [
              {
                fieldid: 'plugin_customfields_at_fogcreek_com_storypoints',
                fieldname: 'Story Points',
                type: 'n',
              },
            ],
          },
        },
      };
    }
    throw new Error('metadata unavailable');
  };

  // Assert (initial)
  assert.equal(typeof callFn, 'function');

  // Act
  const result = await buildColumnCatalog({ ixBug: 123, forceFallback: true }, { callFn });

  // Assert
  assert.equal(result.strategy, 'fallback');
  assert.equal(result.coverage, 'partial');
  assert.equal(result.ixBug, 123);
  assert.ok(result.columns.some((item) => item.id === 'plugin_customfields_at_fogcreek_com_storypoints'));
  assert.ok(result.columns.some((item) => item.source === 'custom'));
  assert.ok(result.counts.custom >= 1);
});

test('buildColumnCatalog: uses metadata API strategy when listColumns returns data', async () => {
  // Arrange
  const callFn = async (payload) => {
    if (payload.cmd === 'listColumns') {
      return {
        columns: {
          column: [
            { id: 'ixBug', name: 'Case ID', type: 'ix' },
            { id: 'sTitle', name: 'Title', type: 's' },
          ],
        },
      };
    }
    throw new Error('unexpected call');
  };

  // Assert (initial)
  assert.equal(typeof callFn, 'function');

  // Act
  const result = await buildColumnCatalog({ includeCustom: false }, { callFn });

  // Assert
  assert.equal(result.strategy, 'api_metadata');
  assert.equal(result.coverage, 'authoritative');
  assert.equal(result.columns.length, 2);
  assert.equal(result.counts.custom, 0);
  assert.equal(result.warnings.length, 0);
});

test('inferFogBugzishType: maps known prefixes', () => {
  // Arrange
  const values = ['ixBug', 'sTitle', 'dtLastUpdated', 'fResolved', 'nEstimate', 'hrsOrigEst', 'xOther'];

  // Assert (initial)
  assert.equal(values.length, 7);

  // Act
  const actual = values.map((value) => inferFogBugzishType(value));

  // Assert
  assert.deepEqual(actual, ['ix', 's', 'dt', 'f', 'n', 'hrs', 'unknown']);
});
