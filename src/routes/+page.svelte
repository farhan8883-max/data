<!--
  Halaman Login + Register + Lupa/Reset password (1 file).
  Taruh di: src/routes/+page.svelte
  Setelah login berhasil otomatis pindah ke /dashboard.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '../lib/supabase';

  let mode = $state('masuk'); // 'masuk' | 'daftar' | 'lupa'
  let recovery = $state(false);
  let ready = $state(false);
  let nama = $state('');
  let email = $state('');
  let password = $state('');
  let password2 = $state('');
  let show = $state(false);
  let busy = $state(false);
  let msg = $state('');
  let err = $state('');

  const back = () => window.location.origin + '/';

  onMount(() => {
    // datang dari tautan "reset password" di Gmail
    if (location.hash.includes('type=recovery')) recovery = true;

    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !recovery) goto('/dashboard', { replaceState: true });
      else ready = true;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') { recovery = true; ready = true; }
      else if (event === 'SIGNED_IN' && s && !recovery) goto('/dashboard', { replaceState: true });
    });
    return () => sub.subscription.unsubscribe();
  });

  function pesanError(e) {
    const m = (e?.message || '').toLowerCase();
    if (m.includes('invalid login')) return 'Email atau password salah.';
    if (m.includes('email not confirmed')) return 'Email belum dikonfirmasi. Cek Gmail kamu dan klik tautan konfirmasi.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'Email ini sudah terdaftar. Silakan masuk.';
    if (m.includes('rate limit') || m.includes('too many')) return 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.';
    if (m.includes('password should be')) return 'Password minimal 6 karakter.';
    return e?.message || 'Terjadi kesalahan.';
  }
  function ganti(m) { mode = m; err = ''; msg = ''; }

  async function submit(ev) {
    ev.preventDefault();
    err = ''; msg = '';
    const em = email.trim();

    if (recovery) {
      if (password.length < 6) return (err = 'Password minimal 6 karakter.');
      if (password !== password2) return (err = 'Konfirmasi password tidak sama.');
      busy = true;
      const { error } = await supabase.auth.updateUser({ password });
      busy = false;
      if (error) return (err = pesanError(error));
      msg = 'Password berhasil diganti. Membuka dashboard…';
      setTimeout(() => goto('/dashboard', { replaceState: true }), 900);
      return;
    }

    busy = true;
    if (mode === 'masuk') {
      const { error } = await supabase.auth.signInWithPassword({ email: em, password });
      if (error) err = pesanError(error);
    } else if (mode === 'daftar') {
      if (!nama.trim()) err = 'Isi nama dulu.';
      else if (password.length < 6) err = 'Password minimal 6 karakter.';
      else if (password !== password2) err = 'Konfirmasi password tidak sama.';
      else {
        const { data, error } = await supabase.auth.signUp({
          email: em, password,
          options: { data: { nama: nama.trim() }, emailRedirectTo: back() }
        });
        if (error) err = pesanError(error);
        else if (data.user && data.user.identities?.length === 0) err = 'Email ini sudah terdaftar. Silakan masuk.';
        else if (!data.session) {
          msg = 'Pendaftaran berhasil. Kami kirim tautan konfirmasi ke ' + em + '. Buka Gmail kamu, klik tautannya, lalu masuk.';
          mode = 'masuk'; password = ''; password2 = '';
        }
      }
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: back() });
      if (error) err = pesanError(error);
      else msg = 'Tautan reset password sudah dikirim ke ' + em + '. Cek Gmail (juga folder Spam).';
    }
    busy = false;
  }
</script>

<svelte:head>
  <title>Masuk — Data Pesantren</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap" rel="stylesheet" />
</svelte:head>

<div class="auth">
  {#if !ready}
    <p class="load">Memeriksa login…</p>
  {:else}
    <form class="card" onsubmit={submit}>
      <div class="logo">
        <svg viewBox="0 0 28 28" width="34" height="34" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#6cb2ff"/><path d="M7 11a1.5 1.5 0 0 1 1.5-1.5h3L13 11h6a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 19 20H8.5A1.5 1.5 0 0 1 7 18.5z" fill="#0f2d62"/></svg>
        <span>Data Pesantren</span>
      </div>

      <h1>
        {#if recovery}Buat password baru
        {:else if mode === 'masuk'}Masuk
        {:else if mode === 'daftar'}Daftar akun
        {:else}Lupa password{/if}
      </h1>
      <p class="sub">
        {#if recovery}Masukkan password baru untuk akunmu.
        {:else if mode === 'masuk'}Masuk dengan email Gmail kamu untuk membuka data.
        {:else if mode === 'daftar'}Gunakan email aktif, konfirmasi dikirim ke Gmail.
        {:else}Tautan reset dikirim ke Gmail kamu.{/if}
      </p>

      {#if msg}<div class="note ok" role="status">{msg}</div>{/if}
      {#if err}<div class="note bad" role="alert">{err}</div>{/if}

      {#if !recovery && mode === 'daftar'}
        <label>Nama
          <input bind:value={nama} autocomplete="name" placeholder="Nama lengkap" />
        </label>
      {/if}

      {#if !recovery}
        <label>Email
          <input type="email" bind:value={email} autocomplete="email" inputmode="email" placeholder="nama@gmail.com" required />
        </label>
      {/if}

      {#if recovery || mode !== 'lupa'}
        <label>{recovery ? 'Password baru' : 'Password'}
          <span class="pw">
            <input type={show ? 'text' : 'password'} bind:value={password} autocomplete={mode === 'masuk' && !recovery ? 'current-password' : 'new-password'} placeholder="Minimal 6 karakter" required />
            <button type="button" class="eye" onclick={() => (show = !show)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}>{show ? 'Tutup' : 'Lihat'}</button>
          </span>
        </label>
      {/if}

      {#if recovery || mode === 'daftar'}
        <label>Ulangi password
          <input type={show ? 'text' : 'password'} bind:value={password2} autocomplete="new-password" placeholder="Ketik ulang password" required />
        </label>
      {/if}

      <button class="go" type="submit" disabled={busy}>
        {#if busy}Memproses…
        {:else if recovery}Simpan password
        {:else if mode === 'masuk'}Masuk
        {:else if mode === 'daftar'}Daftar
        {:else}Kirim tautan reset{/if}
      </button>

      {#if !recovery}
        <div class="links">
          {#if mode === 'masuk'}
            <button type="button" onclick={() => ganti('lupa')}>Lupa password?</button>
            <button type="button" onclick={() => ganti('daftar')}>Belum punya akun? Daftar</button>
          {:else}
            <button type="button" onclick={() => ganti('masuk')}>Kembali ke masuk</button>
          {/if}
        </div>
      {/if}
    </form>
  {/if}
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #eff4fb; color: #142039; font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif; font-size: 15px; line-height: 1.45; }
  .auth { min-height: 100dvh; display: grid; place-items: center; padding: 16px; width: 100%; }
  .load { color: #5b6b88; }
  .card { width: 100%; max-width: 400px; background: #fff; border: 1px solid #d8e0ee; border-radius: 14px; padding: 28px 24px; display: grid; gap: 14px; box-shadow: 0 10px 30px rgba(12, 30, 70, .08); }
  .logo { display: flex; align-items: center; gap: 10px; font-family: 'Newsreader', Georgia, serif; font-size: 21px; font-weight: 600; color: #0f2d62; }
  h1 { font-family: 'Newsreader', Georgia, serif; font-size: 30px; line-height: 1.15; margin: 4px 0 0; }
  .sub { margin: -8px 0 0; color: #5b6b88; font-size: 14px; }
  label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
  input { width: 100%; min-width: 0; height: 44px; padding: 0 13px; border: 1px solid #d8e0ee; border-radius: 8px; background: #fff; font: inherit; font-weight: 400; color: #142039; }
  input:focus { outline: 2px solid #6cb2ff; outline-offset: 1px; border-color: #0f2d62; }
  .pw { position: relative; display: block; }
  .pw input { padding-right: 68px; }
  .eye { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: 0; background: none; color: #18408a; font: inherit; font-size: 13px; font-weight: 600; padding: 6px 8px; cursor: pointer; }
  .go { height: 46px; border: 0; border-radius: 8px; background: #0f2d62; color: #fff; font: inherit; font-weight: 600; cursor: pointer; margin-top: 4px; }
  .go:hover:not(:disabled) { background: #18408a; }
  .go:disabled { opacity: .6; cursor: default; }
  .links { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .links button { border: 0; background: none; color: #18408a; font: inherit; font-size: 13px; font-weight: 600; padding: 4px 0; cursor: pointer; }
  .links button:hover { text-decoration: underline; }
  .note { padding: 10px 12px; border-radius: 8px; font-size: 13px; overflow-wrap: anywhere; }
  .note.ok { background: #e4f4ea; color: #1f6b3f; }
  .note.bad { background: #fbe8e5; color: #9d3425; }
</style>