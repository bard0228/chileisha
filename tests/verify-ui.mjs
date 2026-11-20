import { runVerification } from './verify-runner.mjs';

const res = await runVerification({
  file: '/home/antigravity/chileisha/public/index.html',
  width: 412,
  height: 915,
  customScript: '/home/antigravity/chileisha/tests/ui-assertions.mjs',
});

console.log('PASS:', res);
