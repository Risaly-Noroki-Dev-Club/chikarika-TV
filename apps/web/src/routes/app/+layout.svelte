<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { api } from '$lib/utils/api';
	import { user } from '$lib/stores/auth';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
	let isLoading = $state(true);

	onMount(async () => {
		try {
			const res = await api<{ user: any }>('/api/auth/me');
			user.set(res.user);
		} catch {
			await goto('/login');
			return;
		}
		isLoading = false;
	});

	async function handleLogout() {
		await api('/api/auth/logout', { method: 'POST' });
		user.set(null);
		await goto('/login');
	}

	const navItems = [
		{ href: '/app', label: '房间', icon: 'rooms' },
		{ href: '/app/emby', label: 'Emby', icon: 'emby' },
	];

	let currentPath = $derived($page.url.pathname);
</script>

{#if isLoading}
	<div class="flex items-center justify-center min-h-screen">
		<span class="inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" style="color: var(--wr-primary)"></span>
	</div>
{:else}
	<div class="min-h-screen flex flex-col">
		<!-- Top nav -->
		<header class="sticky top-0 z-50 flex items-center justify-between px-4 md:px-6 h-14" style="background: var(--wr-surface); border-bottom: 1px solid var(--wr-border);">
			<div class="flex items-center gap-4">
				<a href="/app" class="text-lg font-bold" style="color: var(--wr-primary)">chikarika-TV</a>
				<nav class="hidden md:flex items-center gap-1">
					{#each navItems as item}
						<a
							href={item.href}
							class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
							style="color: {currentPath === item.href || (item.href !== '/app' && currentPath.startsWith(item.href)) ? 'var(--wr-primary)' : 'var(--wr-text-medium)'}; background: {currentPath === item.href || (item.href !== '/app' && currentPath.startsWith(item.href)) ? 'rgba(138, 180, 248, 0.1)' : 'transparent'};"
						>
							{item.label}
						</a>
					{/each}
				</nav>
			</div>

			<div class="flex items-center gap-3">
				<span class="text-sm" style="color: var(--wr-text-medium)">{$user?.displayName}</span>
				<button
					onclick={handleLogout}
					class="text-xs px-3 py-1.5 rounded-md transition-colors"
					style="color: var(--wr-text-medium); border: 1px solid var(--wr-border);"
				>
					退出
				</button>
			</div>
		</header>

		<!-- Mobile bottom nav -->
		<nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around h-14" style="background: var(--wr-surface); border-top: 1px solid var(--wr-border);">
			{#each navItems as item}
				<a
					href={item.href}
					class="flex flex-col items-center gap-0.5 px-4 py-2 text-xs font-medium"
					style="color: {currentPath === item.href || (item.href !== '/app' && currentPath.startsWith(item.href)) ? 'var(--wr-primary)' : 'var(--wr-text-disabled)'};"
				>
					{item.label}
				</a>
			{/each}
		</nav>

		<!-- Main content -->
		<main class="flex-1 px-4 md:px-6 py-6 pb-20 md:pb-6 max-w-5xl mx-auto w-full">
			{@render children()}
		</main>
	</div>
{/if}
