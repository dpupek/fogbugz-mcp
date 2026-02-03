import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommentWithAttachmentPayload, buildViewCaseCols } from '../index.js';

test('buildViewCaseCols: adds events when includeAttachments is true', () => {
  // Arrange
  const cols = 'sTitle,sStatus';

  // Assert (initial)
  assert.ok(!cols.includes('events'));

  // Act
  const result = buildViewCaseCols(cols, true);

  // Assert
  assert.ok(result.includes('events'));
  assert.ok(result.includes('sTitle'));
});

test('buildViewCaseCols: leaves events out when includeAttachments is false', () => {
  // Arrange
  const cols = 'sTitle,sStatus';

  // Assert (initial)
  assert.ok(!cols.includes('events'));

  // Act
  const result = buildViewCaseCols(cols, false);

  // Assert
  assert.ok(!result.includes('events'));
  assert.ok(result.includes('sTitle'));
});

test('buildCommentWithAttachmentPayload: builds attach form and comment payload', async () => {
  // Arrange
  const input = {
    ixBug: 123,
    text: '**Note**',
    textType: 'markdown',
    filename: 'note.txt',
    contentBase64: Buffer.from('hello').toString('base64'),
  };

  // Assert (initial)
  assert.equal(input.textType, 'markdown');

  // Act
  const result = buildCommentWithAttachmentPayload(input);

  // Assert
  assert.ok(result.attachFiles);
  assert.ok(result.commentPayload);
  assert.equal(result.commentPayload.cmd, 'edit');
  assert.equal(result.commentPayload.ixBug, '123');
  assert.equal(result.commentPayload.fRichText, '1');
  assert.ok(result.commentPayload.sEvent.includes('<strong>Note</strong>'));

  const headers = result.attachFiles.getHeaders();
  assert.ok(headers['content-type']);
});
