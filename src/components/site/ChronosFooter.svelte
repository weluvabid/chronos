<script lang="ts">
  import { SiteFooter, Button, Tooltip } from '@weluvabid/iris/components';
  import { SiGithub } from '@weluvabid/iris/simple-icons';
  import ghostMark from '../../../brand/me/brand/mark.svg?url';
  import ghostMarkDark from '../../../brand/me/brand/mark-dark.svg?url';
</script>

<Tooltip.Provider delayDuration={300}>
  <SiteFooter>
    <a
      class="ghost-link inline-flex size-10 items-center justify-center text-foreground no-underline"
      href="/"
      aria-label="Chronos home"
    >
      <img src={ghostMark} alt="" class="block h-7 w-auto dark:hidden" />
      <img src={ghostMarkDark} alt="" class="hidden h-7 w-auto dark:block" />
    </a>
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
            <SiGithub class="size-6" aria-hidden="true" />
          </Button.Root>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>GitHub repository</Tooltip.Content>
    </Tooltip.Root>
  </SiteFooter>
</Tooltip.Provider>
