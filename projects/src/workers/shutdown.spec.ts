import { drainWorkers } from './shutdown';

describe('worker shutdown', () => {
  it('drains jobs before closing database and queue providers', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const close = jest.fn().mockResolvedValue(undefined);
    const app = {
      get: jest.fn(() => ({ onModuleDestroy: () => pending })),
      close,
    };
    const shutdown = drainWorkers(app as never);
    expect(close).not.toHaveBeenCalled();
    finish();
    await shutdown;
    expect(close).toHaveBeenCalledTimes(1);
  });
});
