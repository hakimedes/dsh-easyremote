type Handler = (args: string[]) => unknown | Promise<unknown>;

export type CommandHandlers = {
  setup: Handler;
  start: Handler;
  quick: Handler;
  stop?: Handler;
  status?: Handler;
  doctor?: Handler;
  upgrade?: Handler;
  backup?: Handler;
  restore?: Handler;
  uninstall?: Handler;
  help?: Handler;
  serviceRun?: Handler;
};

export async function routeCommand(
  args: string[],
  context: { loadState: () => { activeMode: string } | null; handlers: CommandHandlers },
) {
  const command = args[0];
  if (!command) {
    const state = context.loadState();
    return !state || state.activeMode === 'quick'
      ? context.handlers.setup([])
      : context.handlers.start([]);
  }
  const handlerName = command === 'service-run' ? 'serviceRun' : command;
  const handler = context.handlers[handlerName as keyof CommandHandlers];
  if (handler) return handler(args.slice(1));
  throw new Error(`Unknown command: ${command}`);
}
