// The switch at the top of "Add products": from photos (AI), from folders, or one by hand.
import { html } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';

export const addTabs = (active: 'photos' | 'folders') => html`
  <nav class="st-add-tabs" aria-label="Ways to add products">
    <a class="st-add-tab ${active === 'photos' ? 'is-active' : ''}" href="#/add" aria-current="${active === 'photos' ? 'page' : 'false'}">
      ${icon('sparkles', 16)}<span>From photos</span><small>AI</small>
    </a>
    <a class="st-add-tab ${active === 'folders' ? 'is-active' : ''}" href="#/add/folders" aria-current="${active === 'folders' ? 'page' : 'false'}">
      ${icon('folder', 16)}<span>From folders</span>
    </a>
    <a class="st-add-tab" href="#/products/new">${icon('edit', 16)}<span>One by hand</span></a>
  </nav>
`;
