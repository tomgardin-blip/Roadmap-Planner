// Bottom sheet (modal) and toast, shared by the write flows.

export function openSheet(html) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.id = 'rp-sheet';
  wrap.innerHTML = `<div class="sheet-bg" data-sheet-close></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  (document.getElementById('rp-root') || document.body).appendChild(wrap);
  return wrap.querySelector('.sheet');
}

export function closeSheet() {
  document.getElementById('rp-sheet')?.remove();
}

export function toast(msg, kind = '') {
  let t = document.getElementById('rp-toast');
  if (!t) { t = document.createElement('div'); t.id = 'rp-toast'; (document.getElementById('rp-root') || document.body).appendChild(t); }
  t.className = `toast show ${kind}`;
  t.textContent = msg;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = 'toast'; }, kind === 'bad' ? 9000 : 4500);
}
