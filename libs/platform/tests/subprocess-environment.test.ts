import { expect, it } from 'vitest';
import { spawnProcess, spawnJSONLProcess } from '../src/subprocess.js';

it.each([undefined, false])(
  'passes an explicit environment to a real collected child (inheritEnv=%s)',
  async (inheritEnv) => {
    const result = await spawnProcess({
      command: process.execPath,
      args: [
        '-e',
        'console.log(JSON.stringify({hasPath:process.env.PATH!==undefined,marker:process.env.AUTOMAKER_ENV_FIXTURE}))',
      ],
      cwd: process.cwd(),
      env: { AUTOMAKER_ENV_FIXTURE: 'owned-child' },
      inheritEnv,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hasPath: inheritEnv === false ? false : process.env.PATH !== undefined,
      marker: 'owned-child',
    });
  }
);

it.each([undefined, false])(
  'passes an explicit environment to a real JSONL child (inheritEnv=%s)',
  async (inheritEnv) => {
    const messages = [];
    for await (const message of spawnJSONLProcess({
      command: process.execPath,
      args: [
        '-e',
        'console.log(JSON.stringify({hasPath:process.env.PATH!==undefined,marker:process.env.AUTOMAKER_ENV_FIXTURE}))',
      ],
      cwd: process.cwd(),
      env: { AUTOMAKER_ENV_FIXTURE: 'owned-child' },
      inheritEnv,
    }))
      messages.push(message);
    expect(messages).toEqual([
      {
        hasPath: inheritEnv === false ? false : process.env.PATH !== undefined,
        marker: 'owned-child',
      },
    ]);
  }
);
