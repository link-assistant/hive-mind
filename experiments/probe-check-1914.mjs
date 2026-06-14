import { checkDockerStorageDriver, checkDockerDiskSpace } from '../src/isolation-runner.lib.mjs';
const driver = await checkDockerStorageDriver(true);
console.log('storageDriver =', JSON.stringify(driver));
const disk = await checkDockerDiskSpace(true);
console.log('disk =', JSON.stringify(disk));
