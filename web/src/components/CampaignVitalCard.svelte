<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { cardImageUrl, loadPackCards } from '../lib/data';
  import CardRef from './CardRef.svelte';
  const { t, locale, code, name, maximum, damage, onDamage }: {t: Strings; locale: Locale; code?: string; name: string; maximum: number | null; damage: number; onDamage: (amount: number) => void} = $props();
  let image = $state<string | null>(null);
  let feedback = $state(0);
  let changedAt = 0;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  $effect(() => { const key = code; const language = locale; let cancelled = false; image = null; void loadPackCards(language, 'aoa').then(cards => { if (!cancelled) image = cardImageUrl(cards.find(c => c.code === key)?.imagesrc); }).catch(() => { if (!cancelled) image = null; }); return () => { cancelled = true; }; });
  $effect(() => () => clearTimeout(expiry));
  function change(amount: number): void {
    const applied = amount > 0 ? Math.min(amount, Math.max(0, (maximum ?? Infinity) - damage)) : -Math.min(-amount, damage);
    if (applied === 0) return;
    const delta = -applied;
    const now = performance.now();
    feedback = now - changedAt < 800 && Math.sign(feedback) === Math.sign(delta) ? feedback + delta : delta;
    changedAt = now;
    clearTimeout(expiry);
    expiry = setTimeout(() => { feedback = 0; }, 900);
    onDamage(applied);
  }
</script>
<section class="vital-card" class:hurt={feedback < 0} class:healed={feedback > 0} aria-label={name}>
  {#if image}<img src={image} alt="" class="art" />{/if}
  <h3>{#if code}<CardRef {code} {name} />{:else}{name}{/if}</h3>
  <p class="hp" aria-live="polite">{maximum === null ? '★' : Math.max(0, maximum - damage)} <small>/ {maximum ?? '★'}</small></p>
  <p>{t.statHealth}</p>
  {#if feedback !== 0}<span class="feedback" aria-hidden="true">{feedback > 0 ? '+' : '−'}{Math.abs(feedback)}</span>{/if}
  <div class="controls">
    <button class="btn" disabled={maximum !== null && damage >= maximum} onclick={() => change(1)} aria-label={`${name}: −1 ${t.statHealth}`}>−1</button>
    <button class="btn" disabled={damage === 0} onclick={() => change(-1)} aria-label={`${name}: +1 ${t.statHealth}`}>+1</button>
    <button class="btn" disabled={maximum !== null && damage >= maximum} onclick={() => change(5)} aria-label={`${name}: −5 ${t.statHealth}`}>−5</button>
    <button class="btn" disabled={damage === 0} onclick={() => change(-5)} aria-label={`${name}: +5 ${t.statHealth}`}>+5</button>
  </div>
</section>
<style>
  .vital-card { position: relative; isolation: isolate; overflow: hidden; padding: var(--space-4); background: #171923; color: white; border: 2px solid #575968; }
  .art { position: absolute; z-index: -2; inset: -25% 0 auto; width: 100%; height: 200%; object-fit: cover; object-position: center 25%; filter: blur(2px); opacity: .8; }
  .vital-card::before { content: ''; position: absolute; inset: 0; z-index: -1; background: linear-gradient(100deg,#10131ded,#10131daa); }
  h3 { margin: 0; font-size: var(--text-xl); }
  .hp { font-size: 2.5rem; font-weight: 900; margin: var(--space-3) 0 0; }
  small { font-size: 1rem; font-weight: 500; }
  .controls { display: grid; grid-template-columns: repeat(2,1fr); gap: var(--space-3); }
  .controls button { min-height: 48px; background: #fff8f0; color: #171923; }
  .controls button:disabled { background: #343844; color: #c9cbd1; opacity: 1; }
  .feedback { position: absolute; top: 4rem; right: 1rem; padding: .25rem .6rem; font-size: 1.5rem; font-weight: 900; background: #36121d; color: #ffc1cb; }
  .hurt { border-color: #ff6378; box-shadow: inset 0 0 24px #ff284638; }
  .healed { border-color: #68efba; box-shadow: inset 0 0 24px #30de9738; }
  .healed .feedback { color: #b8ffe4; background: #103328; }
  @media (prefers-reduced-motion: no-preference) { .feedback { animation: rise .9s ease-out; } @keyframes rise { from { transform: translateY(5px); } to { transform: translateY(-8px); } } }
</style>
