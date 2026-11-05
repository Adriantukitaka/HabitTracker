import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

window.scrollTo = () => {};
afterEach(() => cleanup());
