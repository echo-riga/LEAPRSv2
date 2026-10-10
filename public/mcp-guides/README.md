# Real setup screenshots

Save cropped PNG/WebP screenshots of the actual Claude/ChatGPT setup dialogs here. Keep only the relevant setup controls; omit account details, unrelated chats, secrets, and private data. Use automatic registration screens, not the old manual client credentials flow.

The Claude screenshots are wired in this order:

1. `msedge_nar8S2nYPz.png` — Customize
2. `msedge_ljdr9sIrmV.png` — Connectors
3. `msedge_KZ4Gj7NVgj.png` — Add custom connector
4. `msedge_uU17SijQbQ.png` — Name and URL
5. `msedge_6nJr5kXUBd.png` — Sign in now and Register automatically
6. `msedge_jZUP7536ed.png` — Add
7. `msedge_9Lm3QEmiKI.png` — Connect
8. `msedge_SbIzoZFlpt.png` — Allow access
9. `msedge_mPX4znAdbs.png` — Enable LEAPRS and send a request lookup message

All screenshots are 500 × 400. The dialog reserves a consistent image area and instruction height so moving between steps does not resize it. `msedge_vSGZePT5xt.png` is another capture of Connect and is not used.

The ChatGPT screenshots are wired in this order:

1. `msedge_hL1hpMD70l.png` — Plugins
2. `msedge_E4tKMNuDAG.png` — Add custom MCP server
3. `msedge_AGUYBZX0aa.png` — Name, URL, OAuth, and advanced settings
4. `msedge_77eADp5dLL.png` — Dynamic Client Registration (DCR)
5. `msedge_Opx7kpU7Vm.png` — Create as a plugin
6. `msedge_3aZ5ntIFf5.png` — Continue to LEAPRS
7. `msedge_C5Ydm6f4qK.png` — Allow access
8. `msedge_ZTRa8CktJE.png` — Select LEAPRS and send a request lookup message

Attach each image to its matching step in `src/lib/ai-app-guides.ts`:

```ts
{
  instruction: 'Select Sign in now and Register automatically.',
  screenshot: {
    src: '/mcp-guides/msedge_6nJr5kXUBd.png',
    alt: 'Claude connector setup with Sign in now and Register automatically selected.',
    width: 500,
    height: 400,
  },
}
```

Use the image's actual dimensions. The dialog shows one step at a time with Back/Next controls. Screenshots stay centered, retain their proportions, and fit within the dialog; clicking one opens the original full-size image. Steps without screenshots show their instructions only. Do not generate screenshots with AI.
