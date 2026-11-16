<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { Button, Card } from '@weluvabid/iris/components';
  import * as Table from '@weluvabid/iris/components/ui/table';
  import { Activity, Clock3, Cpu, Gauge, Play, RefreshCw, Users } from '@weluvabid/iris/lucide';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { TimerState, type TimerSnapshot } from '@lib/chronos/core/types.ts';
  import type { EngineMetrics } from '@lib/chronos/core/engine.ts';
  import type { SimulationSummary } from '@lib/chronos/simulation/call-centre.ts';
  import { ChronosWorkerClient } from '@lib/chronos/worker/client.ts';

  const TARGET_SIZE = 100_000;
  const PAGE_SIZE = 256;
  const ROW_HEIGHT = 52;
  const HEADER_HEIGHT = 40;
  const DEPARTMENTS = ['Support', 'Billing', 'Retention', 'Technical'];
  let scrollElement: HTMLDivElement | undefined = $state();
  let client = $state<ChronosWorkerClient | null>(null);
  let summary = $state<SimulationSummary | null>(null);
  let metrics = $state<EngineMetrics | null>(null);
  let records = $state<readonly TimerSnapshot[]>([]);
  let rowCount = $state(0);
  let windowOffset = $state(0);
  let status = $state<'idle' | 'initializing' | 'ready' | 'error'>('idle');
  let errorMessage = $state('');
  let isBusy = $state(false);
  let dueEventCount = $state(0);
  let desiredOffset = 0;
  let desiredLimit = PAGE_SIZE;
  let windowRequestPending = false;
  let windowRequestRunning = false;
  const virtualizerOptions = {
    getScrollElement: () => scrollElement ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin: HEADER_HEIGHT,
    onChange: () => {
      void requestVisibleWindow();
    },
  };
  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    ...virtualizerOptions,
    count: 0,
  });

  // TanStack's Svelte adapter exposes the virtualizer as a store. Keep its
  // options synchronized through an effect instead of placing $derived inside
  // the options object (which Svelte rejects as an invalid rune placement).
  $effect(() => {
    get(rowVirtualizer).setOptions({
      ...virtualizerOptions,
      count: rowCount,
    });
  });

  function formatDuration(milliseconds: number): string {
    const totalSeconds = Math.floor(milliseconds / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  function stateLabel(state: TimerState): string {
    switch (state) {
      case TimerState.Running: return 'On call';
      case TimerState.Paused: return 'Paused';
      case TimerState.Stopped: return 'Available';
      case TimerState.Free: throw new Error('Free slots must never appear in a timer window.');
      default: throw new Error(`Unknown timer state: ${state}.`);
    }
  }

  function stateClass(state: TimerState): string {
    switch (state) {
      case TimerState.Running: return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
      case TimerState.Paused: return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
      case TimerState.Stopped: return 'bg-muted text-muted-foreground';
      case TimerState.Free: throw new Error('Free slots must never appear in a timer window.');
      default: throw new Error(`Unknown timer state: ${state}.`);
    }
  }

  function deriveDepartment(slot: number): string {
    const department = DEPARTMENTS[slot % DEPARTMENTS.length];

    if (department === undefined) {
      throw new Error(`No department configured for slot ${slot}.`);
    }

    return department;
  }

  function currentVirtualRange(): { first: number; last: number } {
    const items = get(rowVirtualizer).getVirtualItems();
    // The virtualizer can briefly have no measured items while its reactive
    // count/scroll element is settling. Still request the first bounded page.
    const first = items[0]?.index ?? 0;
    const last = items.at(-1)?.index ?? Math.min(Math.max(rowCount - 1, 0), PAGE_SIZE - 1);

    return { first, last };
  }

  function setDesiredWindow(first: number, last: number): void {
    desiredOffset = Math.floor(first / PAGE_SIZE) * PAGE_SIZE;
    desiredLimit = Math.min(10_000, Math.max(PAGE_SIZE, last - desiredOffset + 1));
  }

  async function requestVisibleWindow(force = false): Promise<void> {
    const activeClient = client;

    if (activeClient === null || summary === null) {
      return;
    }

    const range = currentVirtualRange();
    const currentPageCoversRange = records.length > 0 && range.first >= windowOffset && range.last < windowOffset + records.length;

    if (!force && currentPageCoversRange && !windowRequestRunning) {
      return;
    }

    setDesiredWindow(range.first, range.last);

    if (force || windowRequestRunning) {
      windowRequestPending = true;
    }

    if (windowRequestRunning) {
      return;
    }

    windowRequestRunning = true;

    try {
      while (client === activeClient && summary !== null) {
        const offset = desiredOffset;
        const limit = desiredLimit;

        windowRequestPending = false;

        const page = await activeClient.queryWindow(offset, limit);

        if (page.total !== summary.agents) {
          throw new Error(`Worker returned ${page.total} timers; simulation reports ${summary.agents}.`);
        }

        const latestRange = currentVirtualRange();
        const responseCoversRange = latestRange.first >= page.offset && latestRange.last < page.offset + page.records.length;

        if (responseCoversRange) {
          records = page.records;
          windowOffset = page.offset;
          windowRequestPending = false;

          break;
        }

        const cachedPageCoversRange = records.length > 0 && latestRange.first >= windowOffset && latestRange.last < windowOffset + records.length;

        if (cachedPageCoversRange) {
          windowRequestPending = false;

          break;
        }

        setDesiredWindow(latestRange.first, latestRange.last);

        windowRequestPending = true;
      }
    } catch (error) {
      if (client !== activeClient) {
        return;
      }

      errorMessage = error instanceof Error ? error.message : 'Unable to retrieve the visible timer window.';
      status = 'error';
    } finally {
      windowRequestRunning = false;

      if (windowRequestPending && status !== 'error') {
        void requestVisibleWindow();
      }
    }
  }

  async function refreshMetrics(): Promise<void> {
    const activeClient = client;

    if (activeClient === null || status !== 'ready') {
      return;
    }

    try {
      metrics = await activeClient.metrics();
    } catch (error) {
      if (client !== activeClient) {
        return;
      }

      errorMessage = error instanceof Error ? error.message : 'Unable to read engine metrics.';
      status = 'error';
    }
  }

  async function startSimulation(): Promise<void> {
    const activeClient = client;

    if (activeClient === null || isBusy) {
      return;
    }

    isBusy = true;
    status = 'initializing';
    errorMessage = '';

    try {
      summary = await activeClient.loadSimulation(TARGET_SIZE, 0x00c0ffee);

      rowCount = summary.agents;
      status = 'ready';

      // Let Svelte propagate the new virtualizer count before reading its range.
      await tick();
      await requestVisibleWindow(true);
      await refreshMetrics();
    } catch (error) {
      if (client !== activeClient) {
        return;
      }

      errorMessage = error instanceof Error ? error.message : 'Unable to initialize the simulation.';
      status = 'error';
    } finally {
      isBusy = false;
    }
  }

  async function applyChurn(): Promise<void> {
    const activeClient = client;

    if (activeClient === null || isBusy || summary === null) {
      return;
    }

    isBusy = true;

    try {
      summary = await activeClient.churnSimulation(5_000);

      await refreshMetrics();
      await requestVisibleWindow(true);
    } catch (error) {
      if (client !== activeClient) {
        return;
      }

      errorMessage = error instanceof Error ? error.message : 'Simulation churn failed.';
      status = 'error';
    } finally {
      isBusy = false;
    }
  }

  onMount(() => {
    const workerClient = ChronosWorkerClient.create();

    client = workerClient;
    workerClient.onEventsDue = (events) => { dueEventCount += events.length; };
    workerClient.onRuntimeError = (error) => {
      errorMessage = error.message;
      status = 'error';
    };

    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    const reconcile = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void workerClient.reconcile();
      void refreshMetrics();
      void requestVisibleWindow(true);
    };
    const handleVisibility = () => reconcile();
    const handlePageShow = () => reconcile();

    void workerClient.ready.then(() => {
      if (disposed) {
        return;
      }

      refreshTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') {
          return;
        }

        void refreshMetrics();
        void requestVisibleWindow(true);
      }, 1_000);
    }).catch((error: unknown) => {
      if (disposed) {
        return;
      }

      errorMessage = error instanceof Error ? error.message : 'Chronos worker failed to initialize.';
      status = 'error';
    });

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      disposed = true;

      if (refreshTimer !== undefined) {
        clearInterval(refreshTimer);
      }

      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);

      workerClient.onRuntimeError = null;
      workerClient.onEventsDue = null;

      workerClient.close();

      client = null;
    };
  });
</script>

<section class="space-y-8">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="space-y-2">
      <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span class="size-2 rounded-full {status === 'ready' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-muted-foreground/50'}"></span>
        {status === 'ready' ? 'Worker online' : status === 'initializing' ? 'Initializing worker' : status === 'error' ? 'Runtime error' : 'Engine idle'}
      </div>
      <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Chronos runtime</h1>
      <p class="max-w-2xl text-sm leading-6 text-muted-foreground">
        100,000 elapsed-time records, one worker-owned engine, and a virtualized viewport. The UI never receives the full registry.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#if summary === null}
        <Button.Root onclick={startSimulation} disabled={isBusy || client === null}>
          <Play size={16} aria-hidden="true" />
          {isBusy ? 'Starting…' : 'Load 100k agents'}
        </Button.Root>
      {:else}
        <Button.Root variant="outline" onclick={applyChurn} disabled={isBusy}>
          <Activity size={16} aria-hidden="true" />
          Apply 5k operations
        </Button.Root>
      {/if}
    </div>
  </div>

  {#if errorMessage}
    <div role="alert" class="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      {errorMessage}
    </div>
  {/if}

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Card.Root class="rounded-xl border border-border bg-card p-4">
      <div class="flex items-center justify-between text-muted-foreground"><span class="text-sm">Registered timers</span><Users size={17} /></div>
      <p class="mt-3 text-2xl font-semibold tabular-nums">{metrics?.timers.toLocaleString() ?? '—'}</p>
      <p class="mt-1 text-xs text-muted-foreground">All records owned by the worker</p>
    </Card.Root>
    <Card.Root class="rounded-xl border border-border bg-card p-4">
      <div class="flex items-center justify-between text-muted-foreground"><span class="text-sm">Running</span><Clock3 size={17} /></div>
      <p class="mt-3 text-2xl font-semibold tabular-nums">{metrics?.running.toLocaleString() ?? '—'}</p>
      <p class="mt-1 text-xs text-muted-foreground">Timestamp-derived elapsed time</p>
    </Card.Root>
    <Card.Root class="rounded-xl border border-border bg-card p-4">
      <div class="flex items-center justify-between text-muted-foreground"><span class="text-sm">Scheduled events</span><Gauge size={17} /></div>
      <p class="mt-3 text-2xl font-semibold tabular-nums">{metrics?.scheduledEvents.toLocaleString() ?? '0'}</p>
      <p class="mt-1 text-xs text-muted-foreground">Due events delivered: {dueEventCount.toLocaleString()}</p>
    </Card.Root>
    <Card.Root class="rounded-xl border border-border bg-card p-4">
      <div class="flex items-center justify-between text-muted-foreground"><span class="text-sm">Storage capacity</span><Cpu size={17} /></div>
      <p class="mt-3 text-2xl font-semibold tabular-nums">{metrics?.capacity.toLocaleString() ?? '—'}</p>
      <p class="mt-1 text-xs text-muted-foreground">Compact typed-array registry slots</p>
    </Card.Root>
  </div>

  <section class="overflow-hidden rounded-2xl border border-border bg-card">
    <div class="flex flex-col gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <h2 class="font-semibold tracking-tight">Live agent monitor</h2>
        <p class="mt-1 text-xs text-muted-foreground">{summary ? `${summary.agents.toLocaleString()} agents · ${records.length} records in the current data window` : 'Load the simulation to inspect its timer population.'}</p>
      </div>
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw size={14} aria-hidden="true" />
        Visible window refreshes once per second
      </div>
    </div>

    <div
      bind:this={scrollElement}
      class="h-[min(62vh,620px)] min-h-80 overflow-auto overscroll-contain"
      role="region"
      aria-label="Virtualized agent timer list"
      tabindex="0"
    >
      {#if summary === null}
        <div class="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div class="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted"><Clock3 size={21} class="text-muted-foreground" /></div>
          <p class="text-sm font-medium">The engine is waiting for a workload.</p>
          <p class="max-w-sm text-xs leading-5 text-muted-foreground">Start the 100k-agent simulation to populate the worker registry and inspect a bounded virtual window.</p>
        </div>
      {:else}
        <Table.Root
          class="w-full table-fixed"
          aria-label="Virtualized call centre agent timers"
          aria-rowcount={summary.agents + 1}
          aria-colcount={4}
        >
          <Table.Header class="sticky top-0 z-10 bg-muted/40">
            <Table.Row
              aria-rowindex={1}
              class="grid h-10 min-h-10 grid-cols-[1.1fr_1fr_1fr_0.9fr] gap-3"
            >
              <Table.Head class="h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Agent</Table.Head>
              <Table.Head class="h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Department</Table.Head>
              <Table.Head class="h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</Table.Head>
              <Table.Head class="h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Elapsed</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body class="relative block" style={`height: ${$rowVirtualizer.getTotalSize()}px;`}>
            {#each $rowVirtualizer.getVirtualItems() as virtualRow (virtualRow.key)}
              {@const recordIndex = virtualRow.index - windowOffset}
              {#if recordIndex >= 0 && recordIndex < records.length}
                {@const record = records[recordIndex]}
                {#if record !== undefined}
                  <Table.Row
                  aria-rowindex={virtualRow.index + 2}
                  class="absolute inset-x-0 grid grid-cols-[1.1fr_1fr_1fr_0.9fr] items-center gap-3"
                  style={`height: ${virtualRow.size}px; transform: translateY(${virtualRow.start - HEADER_HEIGHT}px);`}
                >
                  <Table.Cell class="font-medium tabular-nums">AGT-{String(record.handle.slot + 1).padStart(6, '0')}</Table.Cell>
                  <Table.Cell class="truncate text-muted-foreground">{deriveDepartment(record.handle.slot)}</Table.Cell>
                  <Table.Cell>
                    <span class={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${stateClass(record.state)}`}>
                      {stateLabel(record.state)}
                    </span>
                  </Table.Cell>
                  <Table.Cell class="text-right font-mono text-xs tabular-nums">{formatDuration(record.elapsedMs)}</Table.Cell>
                  </Table.Row>
                {/if}
              {/if}
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </div>
  </section>

  <p class="text-xs leading-5 text-muted-foreground">
    The registry and scheduler run independently of the DOM. The monitor requests a bounded page (256 records minimum) around the visible range; TanStack Virtual renders only visible rows plus overscan.
  </p>
</section>
