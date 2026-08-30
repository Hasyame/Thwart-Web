<script lang="ts">
  /**
   * The Thwart mark, taken from the Android launcher icon.
   *
   * Geometry copied path for path from `ic_launcher_foreground.xml`, so the two
   * are the same drawing rather than two drawings of the same idea. Its comment
   * there explains the shapes and is worth not re-deciding: a gold T over a card
   * on deep red, filled rather than outlined because at small sizes a stroked
   * glyph has almost no ink in it, and the card sits one shade off the
   * background for depth without competing.
   *
   * Original geometry — no characters, no logos, no trade dress — which is what
   * makes it ours to use here under the project's MIT licence.
   *
   * `withBackground` draws the red plate. Leave it off over a surface that is
   * already the brand red, which is what the app bar is: the card shape then
   * sits one shade off the bar exactly as it does off the plate.
   */
  interface Props {
    size?: number;
    withBackground?: boolean;
    title?: string | null;
  }

  const { size = 40, withBackground = false, title = null }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 108 108"
  xmlns="http://www.w3.org/2000/svg"
  role={title === null ? 'presentation' : 'img'}
  aria-hidden={title === null ? 'true' : undefined}
  aria-label={title ?? undefined}
>
  {#if title !== null}
    <title>{title}</title>
  {/if}

  {#if withBackground}
    <rect width="108" height="108" rx="24" fill="#B3000F" />
  {/if}

  <!-- The card, tilted, one shade off the plate. -->
  <g transform="rotate(-12 54 54)">
    <path
      fill="#8E0011"
      d="M34 16 L74 16 A5 5 0 0 1 79 21 L79 87 A5 5 0 0 1 74 92 L34 92 A5 5 0 0 1 29 87 L29 21 A5 5 0 0 1 34 16 Z"
    />
  </g>

  <!-- The shadow the letter casts on the card, which is what gives it lift. -->
  <path
    fill="#5C0009"
    fill-opacity="0.55"
    d="M27 33 L87 33 L87 51 L66 51 L66 81 L48 81 L48 51 L27 51 Z"
  />

  <!-- T, filled. -->
  <path fill="#FCC200" d="M24 30 L84 30 L84 48 L63 48 L63 78 L45 78 L45 48 L24 48 Z" />
</svg>

<style>
  svg {
    display: block;
    flex: 0 0 auto;
  }
</style>
