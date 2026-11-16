<script lang="ts">
  import { onMount } from 'svelte';
  import { SiteHeader, Button, Tooltip, DropdownMenu } from '@weluvabid/iris/components';
  import { Moon, Sun, Ellipsis } from '@weluvabid/iris/lucide';
  import { SiGithub } from '@weluvabid/iris/simple-icons';
  import { getInitialTheme, toggleTheme } from '@weluvabid/iris/theme';
  import GhostMark from '@components/brand/GhostMark.svelte';

  let theme = $state<'light' | 'dark'>('light');

  onMount(() => {
    theme = getInitialTheme();
  });

  function handleThemeToggle(): void {
    theme = toggleTheme(theme);
  }
</script>

<Tooltip.Provider delayDuration={300}>
  <SiteHeader>
    <a
      class="ghost-link inline-flex min-h-10 shrink-0 items-center rounded-full font-semibold tracking-tight text-foreground no-underline"
      href="/"
      aria-label="Chronos home"
    >
      <GhostMark class="h-8 w-[34.56px]" gradientId="chronos-header-ghost" />
      <span class="ml-2 text-base">Chronos</span>
    </a>

    <nav class="flex shrink-0 items-center gap-1" aria-label="Primary navigation">
      <div class="hidden items-center gap-1 sm:flex">
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button.Root
                {...props}
                variant="ghost"
                size="icon"
                class="rounded-full"
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                aria-pressed={theme === 'dark'}
                onclick={handleThemeToggle}
              >
                {#if theme === 'dark'}<Sun aria-hidden="true" />{:else}<Moon aria-hidden="true" />{/if}
              </Button.Root>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button.Root
                {...props}
                variant="ghost"
                size="icon"
                class="rounded-full"
                href="https://github.com/weluvabid/chronos"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Chronos on GitHub (opens in a new tab)"
              >
                <SiGithub aria-hidden="true" />
              </Button.Root>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>GitHub repository</Tooltip.Content>
        </Tooltip.Root>
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="flex size-10 items-center justify-center rounded-full text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
          aria-label="More options"
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          align="end"
          side="bottom"
          class="mt-2 min-w-44 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg animate-none duration-0"
        >
          <DropdownMenu.Item class="min-h-10 rounded-lg px-3" onclick={handleThemeToggle}>
            {#if theme === 'dark'}<Sun aria-hidden="true" />{:else}<Moon aria-hidden="true" />{/if}
            <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item class="min-h-10 rounded-lg px-3">
            {#snippet child({ props })}
              <a
                {...props}
                href="https://github.com/weluvabid/chronos"
                target="_blank"
                rel="noopener noreferrer"
              >
                <SiGithub aria-hidden="true" size={16} />
                <span>GitHub</span>
              </a>
            {/snippet}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </nav>
  </SiteHeader>
</Tooltip.Provider>
