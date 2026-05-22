<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/utils/api';

	let rooms = $state<any[]>([]);
	let isLoading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			const res = await api<{ rooms: any[] }>('/api/rooms');
			rooms = res.rooms;
		} catch (err: any) {
			error = err.message;
		} finally {
			isLoading = false;
		}
	});
</script>

<div class="wr-fade-in">
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-xl font-bold">我的房间</h1>
		<a href="/app/rooms/new" class="wr-btn wr-btn-primary text-sm">创建房间</a>
	</div>

	{#if isLoading}
		<div class="flex justify-center py-12">
			<span class="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style="color: var(--wr-primary)"></span>
		</div>
	{:else if error}
		<div class="rounded-md px-4 py-3 text-sm" style="background: rgba(255, 180, 171, 0.1); color: var(--wr-error)">
			{error}
		</div>
	{:else if rooms.length === 0}
		<div class="wr-card p-8 text-center">
			<p style="color: var(--wr-text-medium)">还没有房间</p>
			<p class="mt-2 text-sm" style="color: var(--wr-text-disabled)">创建一个房间，邀请朋友一起看电影</p>
			<a href="/app/rooms/new" class="wr-btn wr-btn-secondary mt-4 inline-flex">创建房间</a>
		</div>
	{:else}
		<div class="grid gap-3">
			{#each rooms as room}
				<a href="/room/{room.id}" class="wr-card p-4 flex items-center justify-between group">
					<div>
						<h3 class="font-medium">{room.title}</h3>
						<p class="text-sm mt-1" style="color: var(--wr-text-medium)">
							{room.role === 'owner' ? '房主' : '成员'}
							·
							<span style="color: {room.status === 'open' ? 'var(--wr-success)' : 'var(--wr-text-disabled)'}">
								{room.status === 'open' ? '进行中' : '已关闭'}
							</span>
						</p>
					</div>
					<span class="text-sm opacity-0 group-hover:opacity-100 transition-opacity" style="color: var(--wr-primary)">进入 →</span>
				</a>
			{/each}
		</div>
	{/if}
</div>
