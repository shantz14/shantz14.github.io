// Comments widget: a giscus look-alike backed by this site's own /api.
(() => {
  const root = document.getElementById('comments');
  if (!root) return;

  const thread = location.pathname;

  // Same order and labels as GitHub's reactions.
  const REACTIONS = {
    THUMBS_UP: ['👍', '+1'],
    THUMBS_DOWN: ['👎', '-1'],
    LAUGH: ['😄', 'Laugh'],
    HOORAY: ['🎉', 'Hooray'],
    CONFUSED: ['😕', 'Confused'],
    HEART: ['❤️', 'Heart'],
    ROCKET: ['🚀', 'Rocket'],
    EYES: ['👀', 'Eyes'],
  };

  // Octicons (MIT License, Copyright (c) GitHub Inc.).
  const ICONS = {
    smiley: 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.82 1.636a.75.75 0 0 1 1.038.175l.007.009c.103.118.22.222.35.31.264.178.683.37 1.285.37.602 0 1.02-.192 1.285-.371.13-.088.247-.192.35-.31l.007-.008a.75.75 0 0 1 1.222.87l-.022-.015c.02.013.021.015.021.015v.001l-.001.002-.002.003-.005.007-.014.019a2.066 2.066 0 0 1-.184.213c-.16.166-.338.316-.53.445-.63.418-1.37.638-2.127.629-.946 0-1.652-.308-2.126-.63a3.331 3.331 0 0 1-.715-.657l-.014-.02-.005-.006-.002-.003v-.002h-.001l.613-.432-.614.43a.75.75 0 0 1 .183-1.044ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM5 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.25 2.25.592.416a97.71 97.71 0 0 0-.592-.416Z',
    markGithub: 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z',
    signOut: 'M2 2.75C2 1.784 2.784 1 3.75 1h2.5a.75.75 0 0 1 0 1.5h-2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h2.5a.75.75 0 0 1 0 1.5h-2.5A1.75 1.75 0 0 1 2 13.25Zm10.44 4.5-1.97-1.97a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.97-1.97H6.75a.75.75 0 0 1 0-1.5Z',
    markdown: 'M14.85 3c.63 0 1.15.52 1.14 1.15v7.7c0 .63-.51 1.15-1.15 1.15H1.15C.52 13 0 12.48 0 11.84V4.15C0 3.52.52 3 1.15 3ZM9 11V5H7L5.5 7 4 5H2v6h2V8l1.5 1.92L7 8v3Zm2.99.5L14.5 8H13V5h-2v3H9.5Z',
    typography: 'M6.71 10H2.332l-.874 2.498a.75.75 0 0 1-1.415-.496l3.39-9.688a1.217 1.217 0 0 1 2.302.018l3.227 9.681a.75.75 0 0 1-1.423.474Zm3.13-4.358C10.53 4.374 11.87 4 13 4c1.5 0 3 .939 3 2.601v5.649a.75.75 0 0 1-1.448.275C13.995 12.82 13.3 13 12.5 13c-.77 0-1.514-.231-2.078-.709-.577-.488-.922-1.199-.922-2.041 0-.694.265-1.411.887-1.944C11 7.78 11.88 7.5 13 7.5h1.5v-.899c0-.54-.5-1.101-1.5-1.101-.869 0-1.528.282-1.84.858a.75.75 0 1 1-1.32-.716ZM6.21 8.5 4.574 3.594 2.857 8.5Zm8.29.5H13c-.881 0-1.375.22-1.637.444-.253.217-.363.5-.363.806 0 .408.155.697.39.896.249.21.63.354 1.11.354.732 0 1.26-.209 1.588-.449.35-.257.412-.495.412-.551Z',
    arrowUp: 'M3.47 7.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018L9 4.81v7.44a.75.75 0 0 1-1.5 0V4.81L4.53 7.78a.75.75 0 0 1-1.06 0Z',
    kebab: 'M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  };

  const state = {
    data: null,
    loading: true,
    error: null,
    order: 'oldest',
    // Editor state survives re-renders, keyed by "main", "reply:<id>" or "edit:<id>".
    drafts: {},
  };

  // ── DOM helpers ──

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v; // only ever server-sanitized markdown
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c != null && c !== false) el.append(c);
    }
    return el;
  }

  function icon(name, size = 16, cls = '') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', ('octicon ' + cls).trim());
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const absolute = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', timeZoneName: 'short',
  });

  function timeAgo(iso) {
    const secs = (new Date(iso) - Date.now()) / 1000;
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, size] of units) {
      if (Math.abs(secs) >= size) return relative.format(Math.round(secs / size), unit);
    }
    return relative.format(0, 'second');
  }

  function timeEl(iso) {
    return h('time', { title: absolute.format(new Date(iso)), datetime: iso }, timeAgo(iso));
  }

  const loginUrl = () => '/auth/login?return=' + encodeURIComponent(location.pathname + location.search + '#comments');

  // ── API ──

  async function api(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body || {});
    }
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      let msg = `Request failed (${resp.status})`;
      try { msg = (await resp.json()).error || msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    return resp.status === 204 ? null : resp.json();
  }

  async function load() {
    try {
      state.data = await api('GET', '/api/thread?key=' + encodeURIComponent(thread));
      state.error = null;
    } catch (err) {
      state.error = err.message;
    }
    state.loading = false;
    render();
  }

  // Runs a mutation, then refreshes from the server either way.
  async function mutate(fn) {
    try {
      await fn();
    } catch (err) {
      window.alert(err.message);
    }
    await load();
  }

  // ── Reactions ──

  function toggleLocal(groups, content) {
    const g = groups[content] || (groups[content] = { count: 0, viewerHasReacted: false });
    g.count += g.viewerHasReacted ? -1 : 1;
    g.viewerHasReacted = !g.viewerHasReacted;
    if (g.count <= 0) delete groups[content];
    return g.viewerHasReacted ? 1 : -1;
  }

  function react(target, groups, content) {
    if (!state.data.viewer) return;
    const delta = toggleLocal(groups, content);
    if (target.type === 'thread') state.data.reactionCount += delta;
    render();
    mutate(() => api('POST', '/api/reactions', { targetType: target.type, targetId: target.id, content }));
  }

  function upvote(c) {
    if (!state.data.viewer) return;
    c.upvoteCount += c.viewerHasUpvoted ? -1 : 1;
    c.viewerHasUpvoted = !c.viewerHasUpvoted;
    render();
    mutate(() => api('POST', '/api/reactions', { targetType: 'comment', targetId: String(c.id), content: 'UPVOTE' }));
  }

  function reactButtons(target, groups, position) {
    const signedIn = !!state.data.viewer;
    const info = h('p', { class: 'gsc-popover-info' });
    const setInfo = (content) => {
      if (!signedIn) {
        info.replaceChildren(h('a', { href: loginUrl(), class: 'color-text-link' }, 'Sign in'), ' to add your reaction.');
      } else {
        info.textContent = content ? REACTIONS[content][1] : 'Pick your reaction';
      }
    };
    setInfo(null);

    const details = h('details', { class: 'gsc-reactions-menu' });
    const emojis = Object.entries(REACTIONS).map(([content, [emoji, label]]) => {
      const reacted = groups[content]?.viewerHasReacted;
      return h('button', {
        type: 'button',
        class: 'gsc-emoji-button' + (reacted ? ' has-reacted' : ''),
        'aria-label': `${reacted ? 'Remove' : 'Add'} the ${label} reaction`,
        disabled: !signedIn,
        onclick: () => { details.open = false; react(target, groups, content); },
        onmouseenter: () => setInfo(content),
        onfocus: () => setInfo(content),
        onmouseleave: () => setInfo(null),
        onblur: () => setInfo(null),
      }, h('span', { class: 'gsc-emoji' }, emoji));
    });

    details.append(
      h('summary', { class: 'link-secondary gsc-reactions-button gsc-social-reaction-summary-item', 'aria-label': 'Add reactions' },
        icon('smiley')),
      h('div', { class: `gsc-reactions-popover ${position} left` },
        info,
        h('div', { class: 'gsc-popover-divider' }),
        h('div', { class: 'gsc-popover-emojis' }, emojis)),
    );

    const direct = Object.entries(REACTIONS)
      .filter(([content]) => groups[content]?.count > 0)
      .map(([content, [emoji, label]]) => {
        const g = groups[content];
        const title = signedIn
          ? `${plural(g.count, 'person', 'people')} reacted with ${label} emoji`
          : 'You must be signed in to add reactions.';
        return h('button', {
          type: 'button',
          class: 'gsc-direct-reaction-button gsc-social-reaction-summary-item' + (g.viewerHasReacted ? ' has-reacted' : ''),
          disabled: !signedIn,
          title,
          'aria-label': `Add the ${label} reaction`,
          onclick: () => react(target, groups, content),
        },
        h('span', { class: 'gsc-direct-reaction-button-emoji' }, emoji),
        h('span', { class: 'gsc-social-reaction-summary-item-count' }, g.count));
      });

    return [details, h('div', { class: 'gsc-direct-reaction-buttons' }, direct)];
  }

  // ── Comment box ──

  function draft(key, init) {
    return state.drafts[key] || (state.drafts[key] = { text: '', preview: false, open: false, fixedWidth: false, ...init });
  }

  function focusBox(key) {
    root.querySelector(`textarea[data-key="${CSS.escape(key)}"]`)?.focus();
  }

  function resize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  }

  async function showPreview(d) {
    d.preview = true;
    if (d.previewFor !== d.text) {
      d.previewFor = d.text;
      d.previewHTML = null;
      if (d.text.trim()) {
        render();
        try {
          d.previewHTML = (await api('POST', '/api/markdown', { body: d.text })).html;
        } catch (err) {
          d.previewHTML = '';
          window.alert(err.message);
        }
      }
    }
    render();
  }

  // kind is "main", "reply" (needs parentId) or "edit" (needs comment).
  function commentBox(kind, { parentId, comment } = {}) {
    const key = kind === 'main' ? 'main' : `${kind}:${kind === 'reply' ? parentId : comment.id}`;
    const d = draft(key, kind === 'edit' ? { text: comment.bodyMarkdown || '', open: true } : { open: kind === 'main' });
    const viewer = state.data.viewer;

    if (kind === 'reply' && !d.open) {
      return h('div', { class: 'gsc-reply-box' },
        h('button', {
          type: 'button',
          class: 'form-control gsc-reply-box-button',
          onclick: () => { d.open = true; render(); focusBox(key); },
        }, 'Write a reply'));
    }

    const close = () => { delete state.drafts[key]; render(); };

    const submit = async () => {
      if (d.submitting || !d.text.trim()) return;
      d.submitting = true;
      render();
      try {
        if (kind === 'edit') {
          await api('PATCH', `/api/comments/${comment.id}`, { body: d.text });
        } else {
          await api('POST', '/api/comments', { thread, parentId: parentId ?? null, body: d.text });
        }
        delete state.drafts[key];
      } catch (err) {
        d.submitting = false;
        window.alert(err.message);
      }
      await load();
    };

    const submitLabel = { main: 'Comment', reply: 'Reply', edit: 'Update comment' }[kind];
    const submitBtn = viewer
      ? h('button', { type: 'submit', class: 'btn btn-primary ml-1', disabled: !d.text.trim() || d.submitting }, submitLabel)
      : h('a', { class: 'btn btn-primary ml-1', href: loginUrl() }, icon('markGithub', 16, 'mr-2'), ' Sign in with GitHub');

    let main;
    if (d.preview) {
      main = d.previewHTML
        ? h('div', { class: 'markdown gsc-comment-box-preview', html: d.previewHTML })
        : h('div', { class: 'markdown gsc-comment-box-preview' }, d.text.trim() && d.previewHTML === null ? 'Loading preview…' : 'Nothing to preview');
    } else {
      const ta = h('textarea', {
        class: 'form-control gsc-comment-box-textarea' + (d.fixedWidth ? ' gsc-is-fixed-width' : ''),
        dir: 'auto',
        'data-key': key,
        placeholder: viewer ? (kind === 'main' ? 'Write a comment' : 'Write a reply') : 'Sign in to comment',
        disabled: !viewer || d.submitting,
        oninput: (e) => {
          d.text = e.target.value;
          if (submitBtn.tagName === 'BUTTON') submitBtn.disabled = !d.text.trim();
          // Only auto-grow until the user resizes it by hand.
          if (!d.height || d.height === e.target.style.height) {
            resize(e.target);
            d.height = e.target.style.height;
          }
        },
        onkeydown: (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
        },
      });
      ta.value = d.text;
      if (d.height) ta.style.height = d.height;
      main = h('div', { class: 'gsc-comment-box-write' },
        ta,
        h('div', { class: 'form-control gsc-comment-box-textarea-extras' },
          h('a', {
            class: 'link-secondary gsc-comment-box-markdown-hint',
            href: 'https://guides.github.com/features/mastering-markdown/',
            target: '_blank',
            rel: 'nofollow noopener noreferrer',
            title: 'Styling with Markdown is supported',
          }, icon('markdown'))));
    }

    const tab = (label, selected, onclick) =>
      h('button', { type: 'button', class: 'gsc-tab' + (selected ? ' is-selected' : ''), onclick }, label);

    return h('form', {
      class: 'gsc-comment-box' + (kind !== 'main' ? ' gsc-comment-box-is-reply' : ''),
      onsubmit: (e) => { e.preventDefault(); submit(); },
    },
    h('div', { class: 'gsc-comment-box-tabs' },
      h('div', { class: 'gsc-tabs' },
        tab('Write', !d.preview, () => { d.preview = false; render(); focusBox(key); }),
        tab('Preview', d.preview, () => showPreview(d))),
      !d.preview && h('div', { class: 'gsc-comment-box-md-toolbar' },
        h('button', {
          type: 'button',
          class: 'gsc-toolbar-item',
          tabindex: '-1',
          title: d.fixedWidth ? 'Disable fixed width' : 'Enable fixed width',
          onclick: () => { d.fixedWidth = !d.fixedWidth; render(); focusBox(key); },
        }, icon('typography')))),
    h('div', { class: 'gsc-comment-box-main' }, main),
    h('div', { class: 'gsc-comment-box-bottom' },
      viewer && kind === 'main' && h('button', {
        type: 'button',
        class: 'link-secondary gsc-sign-out',
        onclick: () => mutate(() => api('POST', '/auth/logout')),
      }, icon('signOut', 16, 'mr-2'), 'Sign out'),
      h('div', { class: 'gsc-comment-box-buttons' },
        kind !== 'main' && h('button', { type: 'button', class: 'btn ml-1', onclick: close }, 'Cancel'),
        submitBtn)));
  }

  // ── Comments ──

  function badge(c, extraClass) {
    if (c.authorAssociation !== 'OWNER') return null;
    return h('div', { class: 'gsc-badge-wrap' }, h('span', { class: 'gsc-badge ' + extraClass }, 'Owner'));
  }

  function edited(c, cls) {
    if (!c.lastEditedAt) return null;
    return h('button', { type: 'button', class: cls, title: 'Last edited ' + absolute.format(new Date(c.lastEditedAt)) }, 'edited');
  }

  function actionsMenu(c) {
    if (c.deletedAt || !(c.viewerDidAuthor || c.viewerCanDelete)) return null;
    const details = h('details', { class: 'gsc-comment-menu' });
    details.append(
      h('summary', { 'aria-label': 'Comment actions' }, icon('kebab')),
      h('div', { class: 'gsc-comment-menu-items' },
        c.viewerDidAuthor && h('button', {
          type: 'button',
          onclick: () => { draft(`edit:${c.id}`, { text: c.bodyMarkdown || '', open: true }); render(); focusBox(`edit:${c.id}`); },
        }, 'Edit'),
        h('button', {
          type: 'button',
          class: 'is-danger',
          onclick: () => {
            details.open = false;
            if (window.confirm('Are you sure you want to delete this comment?')) {
              mutate(() => api('DELETE', `/api/comments/${c.id}`));
            }
          },
        }, 'Delete')));
    return details;
  }

  function body(c, cls) {
    if (state.drafts[`edit:${c.id}`]) return commentBox('edit', { comment: c });
    if (c.deletedAt) {
      return h('div', { class: `markdown ${cls}` }, h('em', { class: 'color-text-secondary' }, 'This comment was deleted.'));
    }
    return h('div', { class: `markdown ${cls}`, dir: 'auto', html: c.bodyHTML });
  }

  function authorLink(user, ...children) {
    return h('a', { href: user.url, target: '_blank', rel: 'nofollow noopener noreferrer', class: 'gsc-comment-author-avatar' }, ...children);
  }

  function reply(r) {
    const hidden = !!r.deletedAt;
    return h('div', { class: 'gsc-reply', id: `comment-${r.id}` },
      h('div', { class: 'gsc-tl-line' }),
      h('div', { class: 'gsc-reply-row' + (hidden ? ' is-hidden' : '') },
        h('div', { class: 'gsc-reply-author-avatar' },
          h('a', { href: r.author.url, target: '_blank', rel: 'nofollow noopener noreferrer' },
            h('img', { class: 'gsc-avatar', src: r.author.avatarUrl, width: 30, height: 30, alt: '@' + r.author.login, loading: 'lazy' }))),
        h('div', { class: 'gsc-reply-body' },
          !hidden && h('div', { class: 'gsc-reply-header' },
            h('div', { class: 'gsc-reply-author' },
              h('a', { href: r.author.url, target: '_blank', rel: 'nofollow noopener noreferrer' },
                h('span', { class: 'link-primary gsc-ellipsis gsc-login' }, r.author.login)),
              h('a', { href: `#comment-${r.id}`, class: 'link-secondary gsc-ellipsis' }, timeEl(r.createdAt)),
              badge(r, '')),
            edited(r, 'gsc-reply-edited'),
            actionsMenu(r)),
          body(r, 'gsc-reply-content' + (hidden ? ' not-shown' : '')),
          !hidden && h('div', { class: 'gsc-reply-footer' },
            h('div', { class: 'gsc-reply-reactions' },
              reactButtons({ type: 'comment', id: String(r.id) }, r.reactions, 'top'))))));
  }

  function comment(c) {
    const hidden = !!c.deletedAt;
    const replyBox = state.data.viewer && !hidden ? commentBox('reply', { parentId: c.id }) : null;
    const signedIn = !!state.data.viewer;

    return h('div', { class: 'gsc-comment', id: `comment-${c.id}` },
      h('div', { class: 'gsc-card' + (c.viewerDidAuthor ? ' is-author' : '') },
        h('div', { class: 'gsc-comment-header' },
          h('div', { class: 'gsc-comment-author' },
            authorLink(c.author,
              h('img', { class: 'gsc-avatar mr-2', src: c.author.avatarUrl, width: 30, height: 30, alt: '@' + c.author.login, loading: 'lazy' }),
              h('span', { class: 'link-primary gsc-ellipsis gsc-login' }, c.author.login)),
            h('a', { href: `#comment-${c.id}`, class: 'link-secondary gsc-ellipsis' }, timeEl(c.createdAt)),
            badge(c, '')),
          edited(c, 'gsc-comment-edited'),
          actionsMenu(c)),
        body(c, 'gsc-comment-content'),
        h('div', { class: 'gsc-comment-footer' },
          h('div', { class: 'gsc-comment-reactions' },
            h('button', {
              type: 'button',
              class: 'gsc-upvote-button gsc-social-reaction-summary-item' + (c.viewerHasUpvoted ? ' has-reacted' : ''),
              disabled: !signedIn || hidden,
              'aria-label': signedIn ? 'Upvote' : 'You must be signed in to upvote.',
              title: signedIn ? plural(c.upvoteCount, 'upvote', 'upvotes') : 'You must be signed in to upvote.',
              onclick: () => upvote(c),
            },
            icon('arrowUp', 16, 'gsc-direct-reaction-button-emoji'),
            h('span', { class: 'gsc-social-reaction-summary-item-count' }, c.upvoteCount)),
            !hidden && reactButtons({ type: 'comment', id: String(c.id) }, c.reactions, 'top')),
          h('div', { class: 'gsc-comment-replies-count' },
            h('span', {}, plural(c.replyCount, 'reply', 'replies')))),
        c.replies?.length > 0 && h('div', { class: 'gsc-replies' + (replyBox ? '' : ' rounded-b') }, c.replies.map(reply)),
        replyBox));
  }

  function view() {
    if (state.loading) {
      return h('div', { class: 'gsc-loading' },
        h('div', { class: 'gsc-loading-image' }),
        h('span', { class: 'gsc-loading-text' }, 'Loading comments…'));
    }
    if (!state.data) {
      return h('div', { class: 'gsc-main' }, h('h4', { class: 'gsc-comments-count' }, `An error occurred: ${state.error}`));
    }

    const d = state.data;
    const comments = state.order === 'newest' ? [...d.comments].reverse() : d.comments;
    const orderBtn = (order, label) =>
      h('li', { class: 'BtnGroup-item' + (state.order === order ? ' BtnGroup-item--selected' : ''), 'aria-current': String(state.order === order) },
        h('button', { type: 'button', class: 'btn', onclick: () => { state.order = order; render(); } }, label));

    return h('div', { class: 'color-text-primary gsc-main' },
      h('div', { class: 'gsc-reactions' },
        h('h4', { class: 'gsc-reactions-count' },
          h('a', { href: '#comments', class: 'color-text-primary' }, plural(d.reactionCount, 'reaction', 'reactions'))),
        h('div', { class: 'gsc-reactions-row' }, reactButtons({ type: 'thread', id: thread }, d.reactions, 'bottom'))),
      h('div', { class: 'gsc-comments' },
        h('div', { class: 'gsc-header' },
          h('div', { class: 'gsc-left-header' },
            h('h4', { class: 'gsc-comments-count' },
              h('a', { href: '#comments', class: 'color-text-primary underline' }, plural(d.totalCommentCount, 'comment', 'comments'))),
            d.totalReplyCount > 0 && [
              h('h4', { class: 'gsc-comments-count-separator' }, '·'),
              h('h4', { class: 'gsc-replies-count' }, plural(d.totalReplyCount, 'reply', 'replies')),
            ]),
          d.totalCommentCount > 0 && h('ul', { class: 'gsc-right-header BtnGroup' },
            orderBtn('oldest', 'Oldest'),
            orderBtn('newest', 'Newest'))),
        commentBox('main'),
        h('div', { class: 'gsc-timeline' }, comments.map(comment))));
  }

  function render() {
    // Keep focus and caret in whichever editor the user is typing in.
    const active = document.activeElement;
    const key = root.contains(active) && active.dataset?.key;
    const caret = key ? [active.selectionStart, active.selectionEnd] : null;

    root.replaceChildren(view());

    if (key) {
      const ta = root.querySelector(`textarea[data-key="${CSS.escape(key)}"]`);
      if (ta && !ta.disabled) {
        ta.focus();
        ta.setSelectionRange(...caret);
      }
    }
  }

  // Close open popovers and menus when clicking elsewhere.
  document.addEventListener('click', (e) => {
    for (const d of root.querySelectorAll('details[open]')) {
      if (!d.contains(e.target)) d.open = false;
    }
  });

  render();
  load();
})();
