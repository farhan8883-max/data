<!--
  Dashboard Data Pesantren (hanya untuk yang sudah login).
  Taruh di: src/routes/dashboard/+page.svelte
  Butuh: src/lib/supabase.js, dan supabase-auth.sql sudah dijalankan.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import { supabase, configured } from '../../lib/supabase';

  const BUCKET = 'drive';
  const FREE_QUOTA = 1024 ** 3;        // 1 GB (paket Free Supabase)
  const MAX_FILE = 50 * 1024 * 1024;   // 50 MB per berkas (paket Free)

  // ---------- state ----------
  let session = $state(null);
  let authReady = $state(false);
  let loading = $state(false);
  let uploading = $state(0);
  let items = $state([]);
  let thumbs = $state({});
  let currentId = $state(null);
  let view = $state('list');
  let sortBy = $state('nama');
  let filter = $state('all');
  let query = $state('');
  let dragging = $state(false);
  let dragDepth = 0;
  let preview = $state(null);
  let menu = $state(null);
  let dialog = $state(null);
  let toast = $state('');
  let fileInput;
  let toastTimer;

  // ---------- helper ----------
  function flash(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 3600);
  }
  function ext(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }
  const isImage = (it) => it.mime.startsWith('image/');
  function category(it) {
    if (isImage(it)) return 'foto';
    const doc = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md', 'odt', 'rtf'];
    return doc.includes(ext(it.name)) ? 'dokumen' : 'lainnya';
  }
  function tone(it) {
    const e = ext(it.name);
    if (e === 'pdf') return '#b8402f';
    if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(e)) return '#2c5fa8';
    if (['xls', 'xlsx', 'csv'].includes(e)) return '#2a7d4f';
    if (['ppt', 'pptx'].includes(e)) return '#b86a14';
    if (['zip', 'rar', '7z'].includes(e)) return '#6b4fa3';
    if (it.mime.startsWith('video/')) return '#a8366f';
    if (it.mime.startsWith('audio/')) return '#a05a2c';
    if (isImage(it)) return '#0e8a7d';
    return '#5d6e67';
  }
  function kindLabel(it) {
    if (it.type === 'folder') return 'Folder';
    if (isImage(it)) return 'Gambar';
    return ext(it.name).toUpperCase() || 'Berkas';
  }
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
    return b.toFixed(b >= 10 ? 0 : 1) + ' ' + u[i];
  }
  const fmtDate = (t) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const norm = (r) => ({
    id: r.id, type: r.type, name: r.name, parentId: r.parent_id, size: Number(r.size) || 0,
    mime: r.mime || '', path: r.path, createdAt: new Date(r.created_at).getTime()
  });

  const navs = [
    { id: 'all', label: 'Semua berkas', icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
    { id: 'foto', label: 'Foto', icon: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4' },
    { id: 'dokumen', label: 'Dokumen', icon: 'M7 3h7l4 4v14H7zM14 3v4h4' },
    { id: 'lainnya', label: 'Lainnya', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5' }
  ];
  const sorters = {
    nama: (a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }),
    terbaru: (a, b) => b.createdAt - a.createdAt,
    ukuran: (a, b) => b.size - a.size
  };

  // ---------- turunan ----------
  const path = $derived.by(() => {
    const p = [];
    let id = currentId;
    while (id) {
      const f = items.find((i) => i.id === id);
      if (!f) break;
      p.unshift(f);
      id = f.parentId;
    }
    return p;
  });

  const searching = $derived(query.trim() !== '' || filter !== 'all');

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    let list;
    if (q) list = items.filter((i) => i.name.toLowerCase().includes(q));
    else if (filter !== 'all') list = items.filter((i) => i.type === 'file' && category(i) === filter);
    else list = items.filter((i) => i.parentId === currentId);
    if (q && filter !== 'all') list = list.filter((i) => i.type === 'file' && category(i) === filter);
    return [...list].sort((a, b) =>
      a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : sorters[sortBy](a, b)
    );
  });

  const title = $derived(
    query.trim() ? 'Hasil pencarian' : filter !== 'all' ? navs.find((n) => n.id === filter).label : (path.at(-1)?.name ?? 'Semua berkas')
  );
  const subtitle = $derived.by(() => {
    const nf = visible.filter((i) => i.type === 'folder').length;
    const nb = visible.length - nf;
    return [nf && `${nf} folder`, nb && `${nb} berkas`].filter(Boolean).join(', ') || 'Belum ada isi';
  });

  const bySize = $derived.by(() => {
    const o = { foto: 0, dokumen: 0, lainnya: 0 };
    for (const i of items) if (i.type === 'file') o[category(i)] += i.size;
    return o;
  });
  const used = $derived(bySize.foto + bySize.dokumen + bySize.lainnya);
  const pct = (n) => Math.min(100, (n / FREE_QUOTA) * 100);
  const menuItem = $derived(menu ? items.find((i) => i.id === menu.id) : null);
  const who = $derived(session?.user?.user_metadata?.nama || session?.user?.email || '');

  // ---------- login & muat data ----------
  onMount(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { goto('/', { replaceState: true }); return; }
      session = data.session;
      authReady = true;
      loadAll();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!s) goto('/', { replaceState: true });
    });
    return () => sub.subscription.unsubscribe();
  });

  async function logout() {
    await supabase.auth.signOut();
    goto('/', { replaceState: true });
  }

  async function loadAll() {
    loading = true;
    const { data, error } = await supabase.from('drive_items').select('*').order('created_at');
    if (error) {
      flash('Gagal memuat data: ' + error.message);
      loading = false;
      return;
    }
    items = data.map(norm);
    await signThumbs(items.filter((i) => i.type === 'file' && isImage(i)));
    loading = false;
  }

  async function signThumbs(list) {
    if (!list.length) return;
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(list.map((i) => i.path), 3600);
    data?.forEach((d, k) => { if (d.signedUrl) thumbs[list[k].id] = d.signedUrl; });
  }

  // ---------- unggah ----------
  async function saveFiles(list) {
    const files = [...list];
    if (!files.length || !supabase || !session) return;
    uploading += files.length;
    let ok = 0;
    for (const f of files) {
      if (f.size > MAX_FILE) {
        flash(`"${f.name}" berukuran ${fmtSize(f.size)}. Batas per berkas ${fmtSize(MAX_FILE)}.`);
        uploading--;
        continue;
      }
      const filePath = `${session.user.id}/${crypto.randomUUID()}`;
      const up = await supabase.storage.from(BUCKET).upload(filePath, f, {
        contentType: f.type || 'application/octet-stream'
      });
      if (up.error) {
        flash(`Gagal mengunggah "${f.name}": ${up.error.message}`);
        uploading--;
        continue;
      }
      const { data, error } = await supabase.from('drive_items')
        .insert({ type: 'file', name: f.name, parent_id: currentId, size: f.size, mime: f.type || '', path: filePath })
        .select().single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([filePath]);
        flash(`Gagal menyimpan data "${f.name}": ${error.message}`);
        uploading--;
        continue;
      }
      const it = norm(data);
      items.push(it);
      if (isImage(it)) await signThumbs([it]);
      ok++;
      uploading--;
    }
    if (ok) flash(ok === 1 ? '1 berkas terunggah' : `${ok} berkas terunggah`);
  }

  function onPick(e) {
    saveFiles(e.currentTarget.files);
    e.currentTarget.value = '';
  }
  function onDragEnter(e) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    dragging = true;
  }
  function onDragLeave() {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dragging = false;
  }
  function onDrop(e) {
    e.preventDefault();
    dragDepth = 0;
    dragging = false;
    if (e.dataTransfer?.files?.length) saveFiles(e.dataTransfer.files);
  }

  // ---------- aksi ----------
  function openItem(it) {
    if (it.type === 'folder') {
      currentId = it.id;
      query = '';
      filter = 'all';
    } else openPreview(it);
  }

  async function openPreview(it) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(it.path, 3600);
    if (error) return flash('Gagal membuka berkas: ' + error.message);
    const url = data.signedUrl;
    let kind = 'none', text = '';
    const e = ext(it.name);
    if (isImage(it)) kind = 'image';
    else if (e === 'pdf') kind = 'pdf';
    else if (it.mime.startsWith('video/')) kind = 'video';
    else if (it.mime.startsWith('audio/')) kind = 'audio';
    else if (it.mime.startsWith('text/') || ['txt', 'md', 'json', 'csv', 'js', 'css', 'html'].includes(e)) {
      kind = 'text';
      try { text = (await (await fetch(url)).text()).slice(0, 20000); } catch { kind = 'none'; }
    }
    preview = { item: it, url, kind, text };
  }
  const closePreview = () => (preview = null);

  async function download(it) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(it.path, 120, { download: it.name });
    if (error) return flash('Gagal mengunduh: ' + error.message);
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = it.name;
    a.click();
  }

  function showMenu(e, it) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    menu = { id: it.id, x: Math.max(8, Math.min(r.right - 184, innerWidth - 192)), y: Math.min(r.bottom + 4, innerHeight - 190) };
  }

  async function submitDialog() {
    if (!dialog) return;
    const name = dialog.value.trim();
    if (dialog.kind === 'folder') {
      if (!name) return;
      const { data, error } = await supabase.from('drive_items')
        .insert({ type: 'folder', name, parent_id: currentId }).select().single();
      if (error) return flash('Gagal membuat folder: ' + error.message);
      items.push(norm(data));
      flash('Folder dibuat');
    } else if (dialog.kind === 'rename') {
      if (!name) return;
      const { error } = await supabase.from('drive_items').update({ name }).eq('id', dialog.id);
      if (error) return flash('Gagal mengubah nama: ' + error.message);
      items.find((i) => i.id === dialog.id).name = name;
      flash('Nama diubah');
    } else if (dialog.kind === 'delete') {
      await removeItem(dialog.id);
    }
    dialog = null;
  }

  async function removeItem(id) {
    const ids = [id];
    for (let k = 0; k < ids.length; k++) {
      items.filter((i) => i.parentId === ids[k]).forEach((i) => ids.push(i.id));
    }
    const paths = items.filter((i) => ids.includes(i.id) && i.path).map((i) => i.path);
    if (paths.length) {
      const r = await supabase.storage.from(BUCKET).remove(paths);
      if (r.error) return flash('Gagal menghapus berkas: ' + r.error.message);
    }
    const { error } = await supabase.from('drive_items').delete().eq('id', id);
    if (error) return flash('Gagal menghapus: ' + error.message);
    ids.forEach((x) => delete thumbs[x]);
    items = items.filter((i) => !ids.includes(i.id));
    if (ids.includes(currentId)) currentId = null;
    flash('Dihapus');
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (dialog) dialog = null;
      else if (preview) closePreview();
      else menu = null;
    }
  }
</script>

<svelte:window onclick={() => (menu = null)} onkeydown={onKey} ondragover={(e) => e.preventDefault()}
  ondragenter={onDragEnter} ondragleave={onDragLeave} ondrop={onDrop} />

<svelte:head>
  <title>Data Pesantren</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap" rel="stylesheet" />
</svelte:head>

{#if !configured}
  <div class="boot">
    <div class="note">
      <h1>Konfigurasi Supabase belum terbaca</h1>
      <p>Isi <code>.env</code> dengan <code>PUBLIC_SUPABASE_URL</code> dan <code>PUBLIC_SUPABASE_ANON_KEY</code>, simpan, lalu restart <code>npm run dev</code>.</p>
      <p>Variabel yang terbaca: <code>{Object.keys(env).join(', ') || '(kosong)'}</code></p>
    </div>
  </div>
{:else if !authReady}
  <div class="boot"><p class="wait">Memeriksa login…</p></div>
{:else}
  <input bind:this={fileInput} type="file" multiple hidden onchange={onPick} />

  {#if uploading}<div class="progress" role="progressbar" aria-label="Mengunggah"><i></i></div>{/if}

  <div class="app">
    <aside class="side">
      <div class="brand">
        <svg viewBox="0 0 28 28" width="30" height="30" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#6cb2ff"/><path d="M7 11a1.5 1.5 0 0 1 1.5-1.5h3L13 11h6a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 19 20H8.5A1.5 1.5 0 0 1 7 18.5z" fill="#0f2d62"/></svg>
        <span>Data Pesantren</span>
      </div>

      <div class="actions">
        <button class="act sky" onclick={() => fileInput.click()}>Unggah berkas</button>
        <button class="act ghost" onclick={() => (dialog = { kind: 'folder', value: '' })}>Folder baru</button>
      </div>

      <nav class="cats" aria-label="Kategori">
        {#each navs as n}
          <button class="nav" class:on={filter === n.id && !query.trim()} onclick={() => { filter = n.id; query = ''; if (n.id === 'all') currentId = null; }}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={n.icon} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>
            {n.label}
          </button>
        {/each}
      </nav>

      <div class="usage">
        <p class="u-title"><strong>{fmtSize(used)}</strong> terpakai dari {fmtSize(FREE_QUOTA)}</p>
        <div class="meter" role="img" aria-label="Pemakaian penyimpanan">
          <i style="width:{pct(bySize.foto)}%; background:#6cb2ff"></i><i style="width:{pct(bySize.dokumen)}%; background:#c3ddff"></i><i style="width:{pct(bySize.lainnya)}%; background:#8197c2"></i>
        </div>
        <ul>
          <li><span style="background:#6cb2ff"></span>Foto<em>{fmtSize(bySize.foto)}</em></li>
          <li><span style="background:#c3ddff"></span>Dokumen<em>{fmtSize(bySize.dokumen)}</em></li>
          <li><span style="background:#8197c2"></span>Lainnya<em>{fmtSize(bySize.lainnya)}</em></li>
        </ul>
      </div>

      <div class="user">
        <span class="who" title={session.user.email}>{who}</span>
        <button class="out" onclick={logout}>Keluar</button>
      </div>
    </aside>

    <main class="main">
      <header class="head">
        <div class="titles">
          {#if !searching && path.length}
            <nav class="trail" aria-label="Lokasi folder">
              <button onclick={() => (currentId = null)}>Semua berkas</button>
              {#each path.slice(0, -1) as p (p.id)}
                <span aria-hidden="true">/</span>
                <button onclick={() => (currentId = p.id)}>{p.name}</button>
              {/each}
            </nav>
          {/if}
          <h1>{title}</h1>
          <p class="count">{subtitle}</p>
        </div>

        <div class="tools">
          <label class="search">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <input type="search" placeholder="Cari nama berkas" bind:value={query} aria-label="Cari" />
          </label>
          <label class="sort">
            <span class="sr">Urutkan</span>
            <select bind:value={sortBy}>
              <option value="nama">Nama</option>
              <option value="terbaru">Terbaru</option>
              <option value="ukuran">Ukuran</option>
            </select>
          </label>
          <div class="seg" role="group" aria-label="Tampilan">
            <button class:on={view === 'list'} onclick={() => (view = 'list')} aria-label="Daftar" title="Daftar">
              <svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
            <button class:on={view === 'grid'} onclick={() => (view = 'grid')} aria-label="Kotak" title="Kotak">
              <svg viewBox="0 0 24 24" width="17" height="17"><path d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
      </header>

      <section class="files" class:tiles={view === 'grid'} aria-busy={loading}>
        {#if view === 'list' && visible.length}
          <div class="thead"><span>Nama</span><span>Jenis</span><span>Ditambahkan</span><span class="r">Ukuran</span></div>
        {/if}

        {#each visible as it (it.id)}
          <div class="item">
            <button class="open" onclick={() => openItem(it)} title={it.name}>
              <span class="cell-name">
                <span class="ico" class:is-folder={it.type === 'folder'} style="--c:{tone(it)}">
                  {#if it.type === 'folder'}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l1.8 2H19.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="currentColor"/></svg>
                  {:else if thumbs[it.id]}
                    <img src={thumbs[it.id]} alt="" loading="lazy" />
                  {:else}
                    <b>{ext(it.name).slice(0, 4) || 'file'}</b>
                  {/if}
                </span>
                <span class="name-stack">
                  <span class="nm">{it.name}</span>
                  {#if it.type === 'file'}
                    <small class="file-size-mobile">{fmtSize(it.size)}</small>
                  {/if}
                </span>
              </span>
              <span class="kind">{kindLabel(it)}</span>
              <span class="date">{fmtDate(it.createdAt)}</span>
              <span class="sz">{it.type === 'folder' ? '' : fmtSize(it.size)}</span>
            </button>
            <button class="more" onclick={(e) => showMenu(e, it)} aria-label="Aksi untuk {it.name}">
              <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="5.5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="18.5" r="1.7" fill="currentColor"/></svg>
            </button>
          </div>
        {/each}

        {#if loading}
          <div class="empty"><p>Memuat berkas…</p></div>
        {:else if !visible.length}
          <div class="empty">
            {#if searching}
              <p class="big">Tidak ada yang cocok</p>
              <p>Ubah kata kunci atau pilih kategori lain.</p>
            {:else}
              <p class="big">Folder ini belum berisi apa pun</p>
              <p>Seret berkas ke halaman ini, atau pilih dari perangkat.</p>
              <button class="solid" onclick={() => fileInput.click()}>Pilih berkas</button>
            {/if}
          </div>
        {/if}
      </section>
    </main>
  </div>

  {#if menu && menuItem}
    <div class="menu" style="left:{menu.x}px; top:{menu.y}px" role="menu" tabindex="-1">
      <button role="menuitem" onclick={() => openItem(menuItem)}>{menuItem.type === 'folder' ? 'Buka' : 'Lihat'}</button>
      {#if menuItem.type === 'file'}
        <button role="menuitem" onclick={() => download(menuItem)}>Unduh</button>
      {/if}
      <button role="menuitem" onclick={() => (dialog = { kind: 'rename', id: menuItem.id, value: menuItem.name })}>Ganti nama</button>
      <hr />
      <button role="menuitem" class="danger" onclick={() => (dialog = { kind: 'delete', id: menuItem.id, value: menuItem.name })}>Hapus</button>
    </div>
  {/if}

  {#if dialog}
    <div class="scrim" onclick={() => (dialog = null)} role="presentation">
      <form class="dialog" onclick={(e) => e.stopPropagation()} onsubmit={(e) => { e.preventDefault(); submitDialog(); }} role="dialog" aria-modal="true">
        {#if dialog.kind === 'delete'}
          <h2>Hapus “{dialog.value}”?</h2>
          <p>Berkas dan isi folder ini akan dihapus permanen dari Supabase.</p>
          <div class="row">
            <button type="button" class="plain" onclick={() => (dialog = null)}>Batal</button>
            <button type="submit" class="solid red">Hapus</button>
          </div>
        {:else}
          <h2>{dialog.kind === 'folder' ? 'Folder baru' : 'Ganti nama'}</h2>
          <!-- svelte-ignore a11y_autofocus -->
          <input autofocus bind:value={dialog.value} placeholder="Nama" aria-label="Nama" />
          <div class="row">
            <button type="button" class="plain" onclick={() => (dialog = null)}>Batal</button>
            <button type="submit" class="solid">{dialog.kind === 'folder' ? 'Buat folder' : 'Simpan'}</button>
          </div>
        {/if}
      </form>
    </div>
  {/if}

  {#if preview}
    <div class="viewer" role="dialog" aria-modal="true">
      <header>
        <button class="x" onclick={closePreview} aria-label="Tutup">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <strong>{preview.item.name}</strong>
        <span class="v-size">{fmtSize(preview.item.size)}</span>
        <button class="dl" onclick={() => download(preview.item)}>Unduh</button>
      </header>
      <div class="stage" onclick={closePreview} role="presentation">
        {#if preview.kind === 'image'}
          <img src={preview.url} alt={preview.item.name} onclick={(e) => e.stopPropagation()} />
        {:else if preview.kind === 'pdf'}
          <iframe src={preview.url} title={preview.item.name}></iframe>
        {:else if preview.kind === 'video'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={preview.url} controls onclick={(e) => e.stopPropagation()}></video>
        {:else if preview.kind === 'audio'}
          <audio src={preview.url} controls onclick={(e) => e.stopPropagation()}></audio>
        {:else if preview.kind === 'text'}
          <pre onclick={(e) => e.stopPropagation()}>{preview.text}</pre>
        {:else}
          <div class="nopreview" onclick={(e) => e.stopPropagation()} role="presentation">
            <p>Jenis berkas ini belum bisa dilihat langsung.</p>
            <button class="solid" onclick={() => download(preview.item)}>Unduh berkas</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if dragging}
    <div class="drop"><div><strong>Lepaskan untuk mengunggah</strong><span>ke {path.at(-1)?.name ?? 'Semua berkas'}</span></div></div>
  {/if}
{/if}

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
  :global(:root) {
    --biru: #0f2d62; --biru-2: #18408a; --kertas: #eff4fb; --putih: #ffffff; --tinta: #142039;
    --kabut: #5b6b88; --garis: #d8e0ee; --langit: #6cb2ff; --merah: #b8402f;
    --f-teks: 'Hanken Grotesk', ui-sans-serif, system-ui, 'Segoe UI', sans-serif;
    --f-judul: 'Newsreader', Georgia, 'Times New Roman', serif;
  }
  :global(*, *::before, *::after) { box-sizing: border-box; }
  :global(html) { width: 100%; max-width: 100%; overflow-x: hidden; -webkit-text-size-adjust: 100%; }
  :global(body) { margin: 0; width: 100%; max-width: 100%; overflow-x: hidden; background: var(--kertas); color: var(--tinta); font-family: var(--f-teks); font-size: 15px; line-height: 1.45; }
  button, select, input { font: inherit; color: inherit; max-width: 100%; }
  button { cursor: pointer; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--langit); outline-offset: 2px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  .boot { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
  .wait { color: var(--kabut); }
  .note { background: var(--putih); border: 1px solid var(--garis); border-radius: 10px; padding: 24px 28px; max-width: 460px; width: 100%; }
  .note h1 { font-family: var(--f-judul); font-size: 24px; margin: 0 0 8px; }
  .note p { color: var(--kabut); margin: 8px 0 0; overflow-wrap: anywhere; }
  .note code { background: var(--kertas); padding: 1px 6px; border-radius: 4px; font-size: 13px; }

  .progress { position: fixed; inset: 0 0 auto 0; height: 3px; z-index: 80; background: rgba(15, 45, 98, .15); overflow: hidden; }
  .progress i { display: block; height: 100%; width: 35%; background: var(--langit); animation: geser 1.1s ease-in-out infinite; }
  @keyframes geser { from { transform: translateX(-100%); } to { transform: translateX(300%); } }

  .app { display: grid; grid-template-columns: 272px minmax(0, 1fr); min-height: 100vh; width: 100%; max-width: 100%; }
  .app > * { min-width: 0; }

  .side { background: var(--biru); color: #e8efe9; padding: 24px 18px 22px; display: flex; flex-direction: column; gap: 22px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .brand { display: flex; align-items: center; gap: 12px; font-family: var(--f-judul); font-size: 22px; font-weight: 600; color: #fff; padding: 0 4px; min-width: 0; }
  .brand svg { flex: none; }
  .brand span { min-width: 0; overflow-wrap: anywhere; }
  .actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .act { border-radius: 8px; padding: 11px 14px; font-weight: 600; text-align: center; border: 1px solid transparent; min-width: 0; }
  .act.sky { background: var(--langit); color: #0a1f4a; }
  .act.sky:hover { background: #8cc4ff; }
  .act.ghost { background: transparent; border-color: rgba(255, 255, 255, .26); color: #fff; }
  .act.ghost:hover { background: rgba(255, 255, 255, .08); }

  .cats { display: grid; gap: 2px; min-width: 0; }
  .nav { display: flex; align-items: center; gap: 12px; text-align: left; background: none; border: 0; padding: 10px 12px; border-radius: 8px; color: rgba(255, 255, 255, .74); }
  .nav:hover { background: rgba(255, 255, 255, .07); color: #fff; }
  .nav.on { background: var(--biru-2); color: #fff; font-weight: 600; box-shadow: inset 3px 0 0 var(--langit); }

  .usage { margin-top: auto; font-size: 13px; color: rgba(255, 255, 255, .74); }
  .u-title { margin: 0 0 10px; }
  .u-title strong { color: #fff; font-weight: 600; }
  .meter { display: flex; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, .13); overflow: hidden; gap: 1px; }
  .meter i { display: block; height: 100%; min-width: 0; }
  .usage ul { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
  .usage li { display: flex; align-items: center; gap: 8px; }
  .usage li span { width: 9px; height: 9px; border-radius: 2px; flex: none; }
  .usage li em { margin-left: auto; font-style: normal; color: #fff; }

  .user { display: flex; align-items: center; gap: 10px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, .14); min-width: 0; }
  .who { flex: 1; min-width: 0; font-size: 13px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .out { flex: none; background: none; border: 1px solid rgba(255, 255, 255, .26); color: #fff; border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 600; }
  .out:hover { background: rgba(255, 255, 255, .1); }

  .main { padding: 30px 36px 56px; width: 100%; min-width: 0; }
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; min-width: 0; }
  .titles { min-width: 0; max-width: 100%; }
  .trail { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-bottom: 4px; color: var(--kabut); font-size: 14px; }
  .trail button { background: none; border: 0; padding: 2px 4px; border-radius: 4px; color: var(--kabut); }
  .trail button:hover { color: var(--biru); background: rgba(15, 45, 98, .07); }
  h1 { font-family: var(--f-judul); font-weight: 600; font-size: 34px; line-height: 1.15; margin: 0; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .count { margin: 4px 0 0; color: var(--kabut); }

  .tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; min-width: 0; max-width: 100%; }
  .search { display: flex; align-items: center; gap: 8px; background: var(--putih); border: 1px solid var(--garis); border-radius: 8px; padding: 0 12px; height: 40px; color: var(--kabut); width: 260px; max-width: 100%; }
  .search:focus-within { border-color: var(--biru); color: var(--biru); }
  .search svg { flex: none; }
  .search input { flex: 1; min-width: 0; border: 0; outline: none; background: none; color: var(--tinta); height: 100%; }
  .sort select { height: 40px; background: var(--putih); border: 1px solid var(--garis); border-radius: 8px; padding: 0 10px; }
  .seg { display: flex; border: 1px solid var(--garis); border-radius: 8px; overflow: hidden; background: var(--putih); }
  .seg button { border: 0; background: none; width: 40px; height: 38px; display: grid; place-items: center; color: var(--kabut); }
  .seg button + button { border-left: 1px solid var(--garis); }
  .seg button.on { background: var(--biru); color: #fff; }

  .files { background: var(--putih); border: 1px solid var(--garis); border-radius: 10px; overflow: hidden; min-height: 52vh; min-width: 0; }
  .thead, .open { display: grid; grid-template-columns: minmax(0, 1fr) 96px 130px 90px; column-gap: 16px; align-items: center; }
  .thead { padding: 11px 56px 11px 18px; font-size: 13px; font-weight: 600; color: var(--kabut); background: #f6f9fd; border-bottom: 1px solid var(--garis); }
  .r { text-align: right; }
  .item { position: relative; min-width: 0; }
  .files:not(.tiles) .item + .item { border-top: 1px solid #e5ebf5; }
  .open { width: 100%; text-align: left; background: none; border: 0; padding: 9px 56px 9px 18px; }
  .open > * { min-width: 0; }
  .files:not(.tiles) .open:hover { background: #f0f5fd; }
  .cell-name { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .name-stack { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; min-width: 0; flex: 1; }
  .nm { font-weight: 600; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .file-size-mobile { display: none; color: var(--kabut); font-size: 11px; line-height: 1.25; font-weight: 500; font-variant-numeric: tabular-nums; }
  .kind, .date { color: var(--kabut); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sz { text-align: right; color: var(--kabut); font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .ico { width: 38px; height: 38px; border-radius: 6px; flex: none; display: grid; place-items: center; overflow: hidden; background: color-mix(in srgb, var(--c) 13%, #fff); color: var(--c); }
  .ico b { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
  .ico img { width: 100%; height: 100%; object-fit: cover; }
  .ico svg { width: 24px; height: 24px; }
  .ico.is-folder { background: #e1ebfb; color: var(--biru-2); }

  .more { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border-radius: 50%; border: 0; background: none; display: grid; place-items: center; color: var(--kabut); }
  .more:hover { background: #e3eaf6; color: var(--tinta); }

  .files.tiles { background: none; border: 0; overflow: visible; display: grid; grid-template-columns: repeat(auto-fill, minmax(186px, 1fr)); gap: 16px; align-content: start; }
  .tiles .item { background: var(--putih); border: 1px solid var(--garis); border-radius: 10px; overflow: hidden; }
  .tiles .item:hover { border-color: var(--biru-2); }
  .tiles .open { display: flex; flex-direction: column; padding: 0; }
  .tiles .cell-name { flex-direction: column; align-items: stretch; gap: 0; width: 100%; }
  .tiles .name-stack { display: contents; }
  .tiles .file-size-mobile { display: none !important; }
  .tiles .ico { width: 100%; height: auto; aspect-ratio: 4 / 3; border-radius: 0; }
  .tiles .ico b { font-size: 17px; }
  .tiles .ico svg { width: 42%; height: 42%; }
  .tiles .nm { padding: 11px 14px 0; }
  .tiles .kind { display: none; }
  .tiles .date { padding: 2px 14px 0; font-size: 13px; }
  .tiles .sz { text-align: left; padding: 0 14px 12px; font-size: 13px; min-height: 1.45em; }
  .tiles .more { top: 8px; right: 8px; transform: none; background: rgba(255, 255, 255, .92); border: 1px solid var(--garis); width: 30px; height: 30px; }

  .empty { grid-column: 1 / -1; text-align: center; padding: 14vh 20px; color: var(--kabut); }
  .tiles .empty { background: var(--putih); border: 1px solid var(--garis); border-radius: 10px; }
  .empty p { margin: 4px 0; }
  .empty .big { font-family: var(--f-judul); font-size: 24px; font-weight: 600; color: var(--tinta); }

  .solid { background: var(--biru); color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; font-weight: 600; margin-top: 14px; }
  .solid:hover { background: var(--biru-2); }
  .solid.red { background: var(--merah); }
  .solid.red:hover { background: #9d3425; }

  .menu { position: fixed; z-index: 30; width: 184px; max-width: calc(100vw - 16px); background: var(--putih); border: 1px solid var(--garis); border-radius: 8px; padding: 5px; box-shadow: 0 8px 24px rgba(12, 30, 70, .16); }
  .menu button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 9px 11px; border-radius: 5px; }
  .menu button:hover { background: #ecf1fa; }
  .menu hr { border: 0; border-top: 1px solid var(--garis); margin: 5px 2px; }
  .menu .danger { color: var(--merah); }

  /* dialog: responsif, jadi bottom sheet di HP */
  .scrim { position: fixed; inset: 0; z-index: 40; width: 100%; height: 100dvh; max-width: 100%; display: flex; align-items: center; justify-content: center; padding: 16px; overflow: hidden; background: rgba(8, 20, 48, .5); }
  .dialog { width: 100%; max-width: 420px; min-width: 0; max-height: calc(100dvh - 32px); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; background: var(--putih); border-radius: 12px; padding: 24px; margin: 0; }
  .dialog > * { min-width: 0; max-width: 100%; }
  .dialog h2 { font-family: var(--f-judul); font-weight: 600; font-size: 24px; line-height: 1.2; margin: 0 0 8px; overflow-wrap: anywhere; }
  .dialog p { margin: 0; color: var(--kabut); overflow-wrap: anywhere; }
  .dialog input { display: block; width: 100%; min-width: 0; padding: 11px 13px; border: 1px solid var(--garis); border-radius: 8px; margin-top: 6px; background: var(--putih); }
  .dialog input:focus { border-color: var(--biru); outline: none; }
  .dialog .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  .dialog .row > button { min-width: 0; }
  .dialog .row .solid { margin-top: 0; }
  .plain { background: none; border: 0; padding: 10px 14px; border-radius: 8px; font-weight: 600; color: var(--kabut); }
  .plain:hover { background: #ecf1fa; color: var(--tinta); }

  .viewer { position: fixed; inset: 0; z-index: 50; width: 100%; height: 100dvh; background: #0b1630; color: #fff; display: flex; flex-direction: column; min-height: 0; }
  .viewer header { display: flex; align-items: center; gap: 14px; padding: 10px 18px; border-bottom: 1px solid rgba(255, 255, 255, .1); min-width: 0; }
  .viewer header strong { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .v-size { color: rgba(255, 255, 255, .6); font-size: 14px; white-space: nowrap; }
  .x { background: none; border: 0; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: #fff; flex: none; }
  .x:hover { background: rgba(255, 255, 255, .12); }
  .dl { background: var(--langit); color: #0a1f4a; border: 0; border-radius: 8px; padding: 9px 18px; font-weight: 600; flex: none; }
  .dl:hover { background: #8cc4ff; }
  .stage { flex: 1; min-width: 0; min-height: 0; display: grid; place-items: center; padding: 18px; overflow: auto; }
  .stage img, .stage video { max-width: 100%; max-height: 100%; border-radius: 4px; object-fit: contain; }
  .stage audio { max-width: 100%; }
  .stage iframe { width: min(980px, 100%); height: 100%; border: 0; background: #fff; border-radius: 4px; }
  .stage pre { width: min(900px, 100%); max-height: 100%; overflow: auto; background: var(--putih); color: var(--tinta); padding: 20px; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
  .nopreview { text-align: center; color: rgba(255, 255, 255, .8); }
  .nopreview .solid { background: var(--langit); color: #0a1f4a; }

  .drop { position: fixed; inset: 0; z-index: 60; background: rgba(15, 45, 98, .93); display: grid; place-items: center; color: #fff; pointer-events: none; padding: 16px; }
  .drop div { border: 2px dashed rgba(255, 255, 255, .55); border-radius: 14px; padding: 52px 68px; display: grid; gap: 6px; text-align: center; max-width: 100%; }
  .drop strong { font-family: var(--f-judul); font-size: 30px; font-weight: 600; }
  .drop span { color: rgba(255, 255, 255, .78); overflow-wrap: anywhere; }

  .toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); background: var(--biru); color: #fff; padding: 12px 18px; border-radius: 8px; z-index: 70; box-shadow: 0 8px 24px rgba(0, 0, 0, .25); font-size: 14px; max-width: calc(100vw - 32px); border-left: 4px solid var(--langit); overflow-wrap: anywhere; }

  @media (prefers-reduced-motion: reduce) { .progress i { animation: none; width: 100%; } }
  @media (hover: none) { button { -webkit-tap-highlight-color: transparent; } .more { color: var(--tinta); } }

  @media (max-width: 1100px) {
    .app { grid-template-columns: 232px minmax(0, 1fr); }
    .side { padding: 22px 14px 18px; }
    .main { padding: 26px 24px 48px; }
    .search { width: clamp(170px, 24vw, 220px); }
    .thead, .open { grid-template-columns: minmax(0, 1fr) 78px 112px 76px; column-gap: 10px; }
  }

  @media (max-width: 800px) {
    .app { display: flex; flex-direction: column; min-height: 100vh; }
    .app > * { width: 100%; max-width: 100%; }
    .side { position: relative; top: auto; height: auto; overflow: visible; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px 18px; }
    .brand { flex: 1 1 200px; font-size: 20px; }
    .actions { display: flex; flex: 0 1 auto; gap: 8px; }
    .act { white-space: nowrap; padding: 10px 13px; }
    .cats { display: flex; flex: 1 0 100%; width: 100%; max-width: 100%; gap: 6px; overflow-x: auto; padding: 2px 0 5px; scrollbar-width: none; }
    .cats::-webkit-scrollbar { display: none; }
    .nav { flex: 0 0 auto; white-space: nowrap; padding: 9px 13px; border-radius: 999px; }
    .nav.on { box-shadow: none; }
    .usage { display: none; }
    .user { flex: 1 0 100%; padding-top: 10px; }

    .main { padding: 22px 18px 40px; }
    .head { flex-direction: column; align-items: stretch; gap: 14px; margin-bottom: 16px; }
    h1 { font-size: 28px; }
    .tools { width: 100%; flex-wrap: nowrap; }
    .search { flex: 1 1 auto; width: auto; min-width: 0; }

    .thead, .open { grid-template-columns: minmax(0, 1fr) 80px; column-gap: 10px; }
    .thead span:nth-child(2), .thead span:nth-child(3), .kind, .date { display: none; }
    .files.tiles { grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); gap: 12px; }
    .tiles .date { display: block; }
  }

  @media (max-width: 560px) {
    .side { gap: 10px; padding: 12px; }
    .brand { flex: 1 0 100%; font-size: 19px; }
    .brand svg { width: 28px; height: 28px; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
    .act { padding: 11px 8px; font-size: 14px; }
    .nav { padding: 9px 12px; font-size: 13px; }

    .main { padding: 16px 12px calc(34px + env(safe-area-inset-bottom)); }
    .head { gap: 12px; margin-bottom: 14px; }
    h1 { font-size: clamp(23px, 7vw, 28px); }
    .count { font-size: 13px; }
    .trail { font-size: 12px; }

    .tools { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; align-items: center; }
    .search { grid-column: 1 / -1; width: 100%; height: 44px; }
    .sort { min-width: 0; }
    .sort select { width: 100%; min-width: 0; height: 42px; }
    .seg button { width: 42px; height: 40px; }

    .files { min-height: 42vh; border-radius: 9px; }
    .thead { padding: 10px 48px 10px 12px; grid-template-columns: minmax(0, 1fr) 66px; font-size: 12px; }
    .open { padding: 10px 46px 10px 12px; grid-template-columns: minmax(0, 1fr) 66px; column-gap: 6px; }
    .cell-name { gap: 9px; }
    .ico { width: 36px; height: 36px; }
    .nm { font-size: 13px; }
    .file-size-mobile { display: block; }
    .sz { display: none; }
    .more { right: 4px; width: 36px; height: 36px; }

    .files.tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .tiles .ico { aspect-ratio: 1.15 / 1; }
    .tiles .nm { padding: 9px 10px 0; font-size: 12px; }
    .tiles .date { padding: 3px 10px 0; font-size: 11px; }
    .tiles .sz { display: block; padding: 0 10px 10px; font-size: 11px; }
    .tiles .more { top: 6px; right: 6px; width: 32px; height: 32px; }

    .empty { padding: 9vh 14px; }
    .empty .big { font-size: 20px; }

    .menu { left: 10px !important; right: 10px; top: auto !important; bottom: calc(10px + env(safe-area-inset-bottom)); width: auto; max-width: none; padding: 8px; border-radius: 13px; box-shadow: 0 -6px 30px rgba(8, 20, 48, .3); }
    .menu button { min-height: 46px; padding: 12px 14px; }

    .scrim { align-items: flex-end; padding: 0; }
    .dialog { max-width: 100%; max-height: 88dvh; border-radius: 16px 16px 0 0; padding: 22px 16px calc(18px + env(safe-area-inset-bottom)); }
    .dialog h2 { font-size: 22px; }
    .dialog .row { gap: 8px; }
    .dialog .row > button { flex: 1 1 0; min-height: 46px; padding: 11px 10px; }

    .viewer header { min-height: 56px; padding: 7px 9px; gap: 7px; }
    .viewer header strong { font-size: 13px; }
    .v-size { display: none; }
    .x { width: 36px; height: 36px; }
    .dl { padding: 9px 12px; font-size: 13px; }
    .stage { padding: 8px; }
    .stage iframe { width: 100%; }
    .stage pre { padding: 13px; font-size: 12px; }

    .drop div { width: 100%; padding: 30px 18px; }
    .drop strong { font-size: 22px; }

    .toast { left: 12px; right: 12px; bottom: calc(14px + env(safe-area-inset-bottom)); max-width: none; transform: none; }
  }

  @media (max-width: 360px) {
    .main, .side { padding-left: 9px; padding-right: 9px; }
    .nav { gap: 7px; padding: 8px 10px; font-size: 12px; }
    .files.tiles { gap: 7px; }
    .tiles .nm { padding-left: 8px; padding-right: 8px; }
  }
</style>