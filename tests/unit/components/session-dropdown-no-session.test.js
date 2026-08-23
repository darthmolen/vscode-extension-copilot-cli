/**
 * A surface with no session yet must not display someone else's.
 *
 * Seen live on a window reload: the sidebar's dropdown briefly showed the *tab's*
 * conversation, for the 3.2 seconds between its webview becoming ready and its own
 * session being adopted. Both surfaces then settled correctly, so it read as a
 * cosmetic flicker — but the dropdown was stating, in the UI, that the sidebar was
 * on a session belonging to another surface.
 *
 * The cause is a native `<select>` default. `updateSessions` clears the markup —
 * including the `<option value="">No session</option>` placeholder — and then sets
 * `option.selected = session.id === currentSessionId`. When `currentSessionId` is
 * null nothing matches, no option carries `selected`, and the browser falls back to
 * showing the first one. The list is sorted by mtime descending, so the first one is
 * whichever session was touched most recently: someone else's.
 */

const assert = require('assert');
const { JSDOM } = require('jsdom');

describe('Session dropdown with no session of its own', () => {
	let dom, document, toolbar, container;

	beforeEach(() => {
		dom = new JSDOM('<!DOCTYPE html><div id="container"></div>');
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;
		container = document.getElementById('container');
	});

	afterEach(() => {
		if (toolbar && typeof toolbar.destroy === 'function') { toolbar.destroy(); }
		delete global.document;
		delete global.window;
	});

	async function mount() {
		const { SessionToolbar } = await import(
			'../../../src/webview/app/components/SessionToolbar/SessionToolbar.js'
		);
		toolbar = new SessionToolbar(container);
		return container.querySelector('#sessionDropdown');
	}

	/** Newest first, exactly as `updateSessionsList` orders them. */
	const SESSIONS = [
		{ id: 'someone-elses-session', label: 'the tab is using this one' },
		{ id: 'mine', label: 'the one this surface is on' },
		{ id: 'older', label: 'an older conversation' }
	];

	it('shows no session selected while this surface has none', async () => {
		const dropdown = await mount();

		toolbar.updateSessions(SESSIONS, null);

		assert.notStrictEqual(dropdown.value, 'someone-elses-session',
			'the sidebar claimed the tab\'s session for 3.2 seconds on reload');
		assert.strictEqual(dropdown.value, '',
			'a surface with no session shows the placeholder, not the newest session');
	});

	it('keeps the placeholder reachable in the list', async () => {
		const dropdown = await mount();

		toolbar.updateSessions(SESSIONS, null);

		const placeholder = dropdown.querySelector('option[value=""]');
		assert.ok(placeholder, 'there should still be a "No session" row');
		assert.strictEqual(placeholder.selected, true);
	});

	it('selects this surface\'s own session when it has one', async () => {
		const dropdown = await mount();

		toolbar.updateSessions(SESSIONS, 'mine');

		assert.strictEqual(dropdown.value, 'mine');
	});

	it('adds no placeholder once a real session is selected', async () => {
		const dropdown = await mount();

		toolbar.updateSessions(SESSIONS, 'mine');

		assert.strictEqual(dropdown.querySelector('option[value=""]'), null,
			'the placeholder is for "not yet", not a permanent row');
	});

	it('does not claim a session that is not in the list', async () => {
		// A session filtered out by workspace, or one deleted underneath us.
		const dropdown = await mount();

		toolbar.updateSessions(SESSIONS, 'not-in-this-workspace');

		assert.strictEqual(dropdown.value, '',
			'an unlisted session must not silently resolve to the newest one');
	});

	it('handles an empty session list', async () => {
		const dropdown = await mount();

		toolbar.updateSessions([], null);

		assert.strictEqual(dropdown.value, '');
	});
});
