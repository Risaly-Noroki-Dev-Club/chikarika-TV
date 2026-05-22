import { writable } from 'svelte/store';
import type { User } from '@chikarika-tv/shared';

export const user = writable<User | null>(null);
export const loading = writable(true);
