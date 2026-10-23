import { createLegacyApplication } from './legacy-application.js';

const application = createLegacyApplication({ runStartupTasks: true });

await application.start();
application.installProcessHandlers();
