/**
 * Client half of the Rayrun Bot bundle.
 *
 * A1 skeleton: adds a "Bots" entry to the Harness sidebar and a placeholder
 * page. It reads nothing from the host yet (the only host action is `health`);
 * the real chat list, conversation and details panel will replace this page.
 */
window.__ModuleLoader__.load({
  id: 'dsh-rayrun-bots',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'rayrun-bots'

    const styles = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '28px 32px',
        maxWidth: '720px',
        color: 'var(--dsw-alias-text-1, #0f172a)',
      },
      title: {
        margin: 0,
        fontSize: '18px',
        fontWeight: 650,
      },
      body: {
        margin: 0,
        fontSize: '13px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-text-2, #5b6472)',
      },
      card: {
        border: '1px solid var(--dsw-alias-border-l1, #e4e8f0)',
        borderRadius: '10px',
        padding: '14px 16px',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      },
      code: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12px',
        background: 'var(--dsw-alias-bg-layer-2, #f1f4f9)',
        borderRadius: '4px',
        padding: '1px 4px',
      },
    }

    function PanelIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 20
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('rect', { x: 3.2, y: 4.2, width: 17.6, height: 12.4, rx: 2 }),
        h('path', { d: 'M8 20.4h8M12 16.6v3.8' }),
        h('circle', { cx: 9, cy: 10.4, r: 1.1 }),
        h('circle', { cx: 15, cy: 10.4, r: 1.1 }),
      )
    }

    function BotsPage() {
      return h(
        'div',
        { style: styles.page },
        h('h1', { style: styles.title }, 'Bots'),
        h(
          'p',
          { style: styles.body },
          'The bot layer is under construction. This page is the A1 skeleton: the package loads, the client half renders, and the host half answers ',
          h('code', { style: styles.code }, 'GET /plugins/rayrun-bots?action=health'),
          '.',
        ),
        h(
          'div',
          { style: styles.card },
          h('p', { style: styles.body }, 'Nothing here creates a bot yet. The chat list, conversation and details panel arrive with the first real bot-layer milestone.'),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: () => 'Bots',
            },
            PanelIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
            },
            BotsPage,
          ),
        )
      },
    }
  },
})
