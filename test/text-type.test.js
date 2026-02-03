import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTextTypeToEvent, buildCreateCasePayload, buildEventPayload } from '../index.js';

test('applyTextTypeToEvent: plain leaves event text unchanged', () => {
  // Arrange
  const input = 'Plain update';

  // Assert (initial)
  assert.ok(input.length > 0);

  // Act
  const result = applyTextTypeToEvent({ textType: 'plain', eventText: input });

  // Assert
  assert.equal(result.resolvedTextType, 'plain');
  assert.equal(result.eventText, input);
});

test('applyTextTypeToEvent: markdown converts event and fields.sEvent', () => {
  // Arrange
  const eventText = '**Hello**';
  const fields = { sEvent: '*Note*', ixFixFor: 12 };

  // Assert (initial)
  assert.ok(eventText.includes('**'));
  assert.ok(fields.sEvent.includes('*'));

  // Act
  const result = applyTextTypeToEvent({
    textType: 'markdown',
    eventText,
    fields,
  });

  // Assert
  assert.equal(result.resolvedTextType, 'markdown');
  assert.ok(result.eventText.includes('<strong>Hello</strong>'));
  assert.ok(result.fields.sEvent.includes('<em>Note</em>'));
  assert.equal(result.fields.ixFixFor, 12);
});

test('buildCreateCasePayload: sets fRichText when markdown is used', () => {
  // Arrange
  const input = {
    title: 'Title',
    ixProject: 7,
    event: '## Update',
    textType: 'markdown',
  };

  // Assert (initial)
  assert.equal(input.textType, 'markdown');

  // Act
  const payload = buildCreateCasePayload(input);

  // Assert
  assert.equal(payload.cmd, 'new');
  assert.equal(payload.ixProject, '7');
  assert.equal(payload.fRichText, '1');
  assert.ok(payload.sEvent.includes('<h2>Update</h2>'));
});

test('buildEventPayload: converts markdown fields and sets fRichText', () => {
  // Arrange
  const input = {
    cmd: 'resolve',
    ixBug: 99,
    eventText: undefined,
    fields: { sEvent: 'Update *one*', ixFixFor: 3 },
    textType: 'markdown',
  };

  // Assert (initial)
  assert.equal(input.textType, 'markdown');

  // Act
  const payload = buildEventPayload(input);

  // Assert
  assert.equal(payload.cmd, 'resolve');
  assert.equal(payload.ixBug, '99');
  assert.equal(payload.fRichText, '1');
  assert.ok(payload.sEvent.includes('<em>one</em>'));
  assert.equal(payload.ixFixFor, '3');
});
