import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttachmentDownloadUrl, updateAttachmentUrlsInCase } from '../index.js';

test('buildAttachmentDownloadUrl: removes sTicket and appends token', () => {
  // Arrange
  const input = 'default.asp?pg=pgDownload&pgType=pgAttachment&ixBugEvent=123&sPart=1&sFileName=Test.doc&sTicket=abc';
  const baseUrl = 'https://example.fogbugz.com';
  const token = 'TOKEN123';

  // Assert (initial)
  assert.ok(input.includes('sTicket='));

  // Act
  const result = buildAttachmentDownloadUrl(input, { baseUrl, token });

  // Assert
  const parsed = new URL(result);
  assert.equal(parsed.origin, baseUrl);
  assert.equal(parsed.searchParams.get('token'), token);
  assert.equal(parsed.searchParams.get('sTicket'), null);
  assert.equal(parsed.searchParams.get('ixBugEvent'), '123');
});

test('buildAttachmentDownloadUrl: leaves token off when not provided', () => {
  // Arrange
  const input = 'default.asp?pg=pgDownload&ixBugEvent=123&sTicket=abc';
  const baseUrl = 'https://example.fogbugz.com';

  // Assert (initial)
  assert.ok(input.includes('sTicket='));

  // Act
  const result = buildAttachmentDownloadUrl(input, { baseUrl, token: '' });

  // Assert
  const parsed = new URL(result);
  assert.equal(parsed.searchParams.get('token'), null);
  assert.equal(parsed.searchParams.get('sTicket'), null);
});

test('buildAttachmentDownloadUrl: supports absolute URLs', () => {
  // Arrange
  const input = 'https://example.fogbugz.com/default.asp?pg=pgDownload&ixBugEvent=321&sTicket=zzz';
  const token = 'TOKEN123';

  // Assert (initial)
  assert.ok(input.startsWith('https://'));

  // Act
  const result = buildAttachmentDownloadUrl(input, { baseUrl: 'https://ignored.example', token });

  // Assert
  const parsed = new URL(result);
  assert.equal(parsed.origin, 'https://example.fogbugz.com');
  assert.equal(parsed.searchParams.get('token'), token);
  assert.equal(parsed.searchParams.get('sTicket'), null);
});

test('updateAttachmentUrlsInCase: rewrites attachment urls on events', () => {
  // Arrange
  const caseData = {
    events: {
      event: [
        {
          ixBugEvent: '1',
          rgAttachments: {
            attachment: {
              sURL: 'default.asp?pg=pgDownload&ixBugEvent=1&sTicket=aaa',
            },
          },
        },
        {
          ixBugEvent: '2',
          rgAttachments: {
            attachment: [
              { sURL: 'default.asp?pg=pgDownload&ixBugEvent=2&sTicket=bbb' },
            ],
          },
        },
      ],
    },
  };
  const baseUrl = 'https://example.fogbugz.com';
  const token = 'TOKEN123';

  // Assert (initial)
  assert.ok(caseData.events.event[0].rgAttachments.attachment.sURL.includes('sTicket='));

  // Act
  updateAttachmentUrlsInCase(caseData, { baseUrl, token });

  // Assert
  const firstUrl = new URL(caseData.events.event[0].rgAttachments.attachment.sURL);
  assert.equal(firstUrl.searchParams.get('token'), token);
  assert.equal(firstUrl.searchParams.get('sTicket'), null);

  const secondUrl = new URL(caseData.events.event[1].rgAttachments.attachment[0].sURL);
  assert.equal(secondUrl.searchParams.get('token'), token);
  assert.equal(secondUrl.searchParams.get('sTicket'), null);
});

test('updateAttachmentUrlsInCase: rewrites attachment urls on attachments key', () => {
  // Arrange
  const caseData = {
    events: {
      event: {
        ixBugEvent: '3',
        attachments: {
          attachment: { sURL: 'default.asp?pg=pgDownload&ixBugEvent=3&sTicket=ccc' },
        },
      },
    },
  };
  const baseUrl = 'https://example.fogbugz.com';
  const token = 'TOKEN123';

  // Assert (initial)
  assert.ok(caseData.events.event.attachments.attachment.sURL.includes('sTicket='));

  // Act
  updateAttachmentUrlsInCase(caseData, { baseUrl, token });

  // Assert
  const parsed = new URL(caseData.events.event.attachments.attachment.sURL);
  assert.equal(parsed.searchParams.get('token'), token);
  assert.equal(parsed.searchParams.get('sTicket'), null);
});
