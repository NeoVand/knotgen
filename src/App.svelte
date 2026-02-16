<script lang="ts">
  import { onMount } from 'svelte'
  import { colorForComponent, diagramToSvg, generateDiagram, type Diagram } from './lib/knotgen'

  let crossingTarget = $state(40)
  let seedText = $state('knot-paper-01')
  let strokeWidth = $state(17)
  let cornerInset = $state(0.8)
  let crossingGapScale = $state(1.25)
  let useArcGuideLayout = $state(false)
  let colorByComponent = $state(false)

  let diagram = $state<Diagram | null>(null)
  let runtimeMs = $state(0)
  let statusMessage = $state('')

  function regenerate(): void {
    const startedAt = performance.now()
    const padding = 58 + strokeWidth * 0.7

    try {
      const nextDiagram = generateDiagram({
        crossings: crossingTarget,
        seed: seedText,
        width: 1320,
        height: 900,
        padding,
        cornerInset,
        strokeWidth,
        crossingGapScale,
        useArcGuideLayout,
      })
      diagram = nextDiagram
      runtimeMs = performance.now() - startedAt
      statusMessage = nextDiagram.warning ?? ''
    } catch (error) {
      diagram = null
      runtimeMs = performance.now() - startedAt
      statusMessage = error instanceof Error ? error.message : 'Generation failed.'
    }
  }

  function reseed(): void {
    seedText = Math.random().toString(36).slice(2, 10)
    regenerate()
  }

  function downloadSvg(): void {
    if (!diagram) {
      return
    }

    const svg = diagramToSvg(diagram, {
      strokeWidth,
      strokeColor: '#17202a',
      backgroundColor: '#f5eee0',
      colorByComponent,
    })

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const link = document.createElement('a')
    link.href = url
    link.download = `knot-${diagram.crossings}x-${stamp}.svg`

    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  onMount(() => {
    regenerate()
  })
</script>

<div class="app-shell">
  <aside class="sidebar">
    <header class="hero">
      <p class="kicker">knot figure generator</p>
      <h1>Fast 2D Knot and Link Diagrams</h1>
      <p class="subtitle">
        Generates connected planar 4-regular shadows, then assigns random over/under crossings to produce a knot, link,
        or unknot projection with clean vector geometry.
      </p>
    </header>

    <div class="sidebar-panels">
      <section class="panel controls">
        <label>
          Crossings
          <input type="number" bind:value={crossingTarget} min="3" max="6000" step="1" />
        </label>

        <label>
          Seed
          <input type="text" bind:value={seedText} spellcheck="false" />
        </label>

        <label>
          Stroke
          <input type="range" bind:value={strokeWidth} min="1.2" max="20" step="0.1" oninput={regenerate} />
          <span>{strokeWidth.toFixed(1)} px</span>
        </label>

        <label>
          Corner Inset
          <input type="range" bind:value={cornerInset} min="0.06" max="0.9" step="0.01" oninput={regenerate} />
          <span>{cornerInset.toFixed(2)}</span>
        </label>

        <label>
          Crossing Gap
          <input type="range" bind:value={crossingGapScale} min="0.6" max="3.4" step="0.05" oninput={regenerate} />
          <span>{crossingGapScale.toFixed(2)}x</span>
        </label>

        <label class="toggle">
          <input type="checkbox" bind:checked={useArcGuideLayout} onchange={regenerate} />
          <span>Use Arc Guide Nodes</span>
        </label>

        <label class="toggle">
          <input type="checkbox" bind:checked={colorByComponent} />
          <span>Color Link Components</span>
        </label>

        <div class="buttons">
          <button type="button" onclick={regenerate}>Generate</button>
          <button type="button" class="ghost" onclick={reseed}>New Seed</button>
          <button type="button" class="ghost" onclick={downloadSvg} disabled={!diagram}>Download SVG</button>
        </div>
      </section>

      <section class="panel metrics" aria-live="polite">
        {#if diagram}
          <p><strong>{diagram.crossings}</strong> crossings ({diagram.requestedCrossings} requested)</p>
          <p><strong>{diagram.components}</strong> link component{diagram.components === 1 ? '' : 's'}</p>
          <p><strong>{diagram.primalVertices}</strong> primal vertices / <strong>{diagram.hullVertices}</strong> hull vertices</p>
          <p>crossing radius <strong>{diagram.crossingRadius.toFixed(2)}</strong> / attempts <strong>{diagram.attempts}</strong></p>
          <p>min crossing angle <strong>{diagram.minCrossingAngleDeg.toFixed(1)}°</strong> / quality <strong>{diagram.qualityScore.toFixed(3)}</strong></p>
          <p>generated in <strong>{runtimeMs.toFixed(1)} ms</strong></p>
        {:else}
          <p>No diagram generated yet.</p>
        {/if}

        {#if statusMessage}
          <p class="status">{statusMessage}</p>
        {/if}
      </section>
    </div>
  </aside>

  <section class="panel canvas-panel">
    {#if diagram}
      <svg
        viewBox={`0 0 ${diagram.width} ${diagram.height}`}
        role="img"
        aria-label="Generated knot diagram"
        style={`--stroke-width:${strokeWidth}px;--mask-width:${diagram.haloWidth}px`}
      >
        <rect width="100%" height="100%" class="paper" />

        <g class="under under-pre">
          {#each diagram.basePaths as d, i (`u-pre-${i}`)}
            <path
              d={d}
              style={colorByComponent ? `--path-ink:${colorForComponent(diagram.basePathComponents[i] ?? 0)}` : undefined}
            />
          {/each}
        </g>

        <g class="under-mask">
          {#each diagram.basePaths as d, i (`u-mask-${i}`)}
            <path d={d} />
          {/each}
        </g>

        <g class="under under-final">
          {#each diagram.basePaths as d, i (i)}
            <path
              d={d}
              style={colorByComponent ? `--path-ink:${colorForComponent(diagram.basePathComponents[i] ?? 0)}` : undefined}
            />
          {/each}
        </g>

        <g class="over-mask">
          {#each diagram.overPaths as d, i (`o-mask-${i}`)}
            <path d={d} />
          {/each}
        </g>

        <g class="over">
          {#each diagram.overPaths as d, i (i)}
            <path
              d={d}
              style={colorByComponent ? `--path-ink:${colorForComponent(diagram.overPathComponents[i] ?? 0)}` : undefined}
            />
          {/each}
        </g>
      </svg>
    {:else}
      <p class="status">{statusMessage}</p>
    {/if}
  </section>
</div>
