<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/utils/api';

	let connections = $state<any[]>([]);
	let selectedConnection = $state<string>('');
	let items = $state<any[]>([]);
	let selectedItem = $state<any>(null);
	let searchTerm = $state('');
	let title = $state('');
	let bitrate = $state(4000000);
	let isLoading = $state(true);
	let itemsLoading = $state(false);
	let createLoading = $state(false);
	let error = $state('');
	let step = $state(1);

	onMount(async () => {
		try {
			const res = await api<{ connections: any[] }>('/api/emby/connections');
			connections = res.connections;
			if (connections.length === 1) {
				selectedConnection = connections[0].id;
			}
		} catch (err: any) {
			error = err.message;
		} finally {
			isLoading = false;
		}
	});

	async function loadItems() {
		if (!selectedConnection) return;
		itemsLoading = true;
		try {
			const params = searchTerm ? `?searchTerm=${encodeURIComponent(searchTerm)}` : '';
			const res = await api<{ items: any[]; totalCount: number }>(
				`/api/emby/connections/${selectedConnection}/items${params}`
			);
			items = res.items;
		} catch (err: any) {
			error = err.message;
		} finally {
			itemsLoading = false;
		}
	}

	function selectConnectionAndLoad(id: string) {
		selectedConnection = id;
		step = 2;
		loadItems();
	}

	function selectItem(item: any) {
		selectedItem = item;
		title = item.Name || '观影房间';
		step = 3;
	}

	async function handleCreate() {
		if (!selectedConnection || !selectedItem) return;
		createLoading = true;
		error = '';

		try {
			const res = await api<{ room: any }>('/api/rooms', {
				method: 'POST',
				body: JSON.stringify({
					embyConnectionId: selectedConnection,
					embyItemId: selectedItem.Id,
					title,
					proxyMaxBitrate: bitrate,
				}),
			});
			await goto(`/room/${res.room.id}`);
		} catch (err: any) {
			error = err.message;
		} finally {
			createLoading = false;
		}
	}

	let searchTimeout: ReturnType<typeof setTimeout>;
	function handleSearch(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		searchTerm = value;
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => loadItems(), 400);
	}

	const bitrateOptions = [
		{ value: 2000000, label: '流畅 (2 Mbps)' },
		{ value: 4000000, label: '标准 (4 Mbps)' },
		{ value: 6000000, label: '高清 (6 Mbps)' },
	];
</script>

<div class="wr-fade-in">
	<div class="flex items-center gap-3 mb-6">
		<a href="/app" class="text-sm" style="color: var(--wr-text-medium)">← 返回</a>
		<h1 class="text-xl font-bold">创建房间</h1>
	</div>

	{#if error}
		<div class="rounded-md px-4 py-3 text-sm mb-4" style="background: rgba(255, 180, 171, 0.1); color: var(--wr-error)">
			{error}
		</div>
	{/if}

	{#if isLoading}
		<div class="flex justify-center py-12">
			<span class="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style="color: var(--wr-primary)"></span>
		</div>
	{:else if connections.length === 0}
		<div class="wr-card p-8 text-center">
			<p style="color: var(--wr-text-medium)">需要先绑定 Emby 服务器</p>
			<a href="/app/emby" class="wr-btn wr-btn-primary mt-4 inline-flex">去绑定</a>
		</div>
	{:else}
		<!-- Steps indicator -->
		<div class="flex items-center gap-2 mb-6 text-sm" style="color: var(--wr-text-disabled)">
			<span style="color: {step >= 1 ? 'var(--wr-primary)' : ''}">1. 选择服务器</span>
			<span>→</span>
			<span style="color: {step >= 2 ? 'var(--wr-primary)' : ''}">2. 选择影片</span>
			<span>→</span>
			<span style="color: {step >= 3 ? 'var(--wr-primary)' : ''}">3. 创建房间</span>
		</div>

		<!-- Step 1: Select connection -->
		{#if step === 1}
			<div class="grid gap-3">
				{#each connections as conn}
					<button
						onclick={() => selectConnectionAndLoad(conn.id)}
						class="wr-card p-4 text-left w-full transition-colors"
						style="cursor: pointer;"
					>
						<h3 class="font-medium">{conn.serverName || '未命名服务器'}</h3>
						<p class="text-sm mt-1" style="color: var(--wr-text-medium)">{conn.baseUrl}</p>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Step 2: Select item -->
		{#if step === 2}
			<div class="mb-4">
				<input
					type="text"
					class="wr-input"
					placeholder="搜索影片..."
					value={searchTerm}
					oninput={handleSearch}
				/>
			</div>

			{#if itemsLoading}
				<div class="flex justify-center py-8">
					<span class="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style="color: var(--wr-primary)"></span>
				</div>
			{:else if items.length === 0}
				<div class="wr-card p-8 text-center">
					<p style="color: var(--wr-text-medium)">没有找到影片</p>
				</div>
			{:else}
				<div class="grid gap-2">
					{#each items as item}
						<button
							onclick={() => selectItem(item)}
							class="wr-card p-3 text-left w-full flex items-center gap-3"
						>
							<div class="w-12 h-16 rounded overflow-hidden flex-shrink-0" style="background: var(--wr-surface-3)">
								{#if item.ImageTags?.Primary}
									<img
										src="{connections.find(c => c.id === selectedConnection)?.baseUrl}/Items/{item.Id}/Images/Primary?maxHeight=96&quality=80"
										alt=""
										class="w-full h-full object-cover"
									/>
								{/if}
							</div>
							<div class="min-w-0">
								<h3 class="font-medium truncate">{item.Name}</h3>
								<p class="text-sm truncate" style="color: var(--wr-text-medium)">
									{item.ProductionYear || ''}
									{#if item.RunTimeTicks}
										· {Math.round(item.RunTimeTicks / 600000000)} 分钟
									{/if}
								</p>
								{#if item.Genres?.length}
									<p class="text-xs mt-0.5 truncate" style="color: var(--wr-text-disabled)">{item.Genres.join(', ')}</p>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}

			<button onclick={() => (step = 1)} class="mt-4 text-sm" style="color: var(--wr-text-medium)">
				← 重新选择服务器
			</button>
		{/if}

		<!-- Step 3: Confirm & create -->
		{#if step === 3 && selectedItem}
			<div class="wr-card p-6">
				<div class="flex items-start gap-4 mb-6">
					<div class="w-20 h-28 rounded-lg overflow-hidden flex-shrink-0" style="background: var(--wr-surface-3)">
						{#if selectedItem.ImageTags?.Primary}
							<img
								src="{connections.find(c => c.id === selectedConnection)?.baseUrl}/Items/{selectedItem.Id}/Images/Primary?maxHeight=160&quality=80"
								alt=""
								class="w-full h-full object-cover"
							/>
						{/if}
					</div>
					<div>
						<h3 class="font-medium text-lg">{selectedItem.Name}</h3>
						{#if selectedItem.Overview}
							<p class="text-sm mt-2 line-clamp-3" style="color: var(--wr-text-medium)">{selectedItem.Overview}</p>
						{/if}
					</div>
				</div>

				<div class="flex flex-col gap-4">
					<div>
						<label for="title" class="wr-label">房间标题</label>
						<input id="title" type="text" class="wr-input" bind:value={title} />
					</div>

					<div>
						<label for="bitrate" class="wr-label">朋友代理画质</label>
						<select id="bitrate" class="wr-input" bind:value={bitrate}>
							{#each bitrateOptions as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
						<p class="mt-1 text-xs" style="color: var(--wr-text-disabled)">你作为房主将直连 Emby，朋友通过服务器代理观看</p>
					</div>

					<div class="flex gap-3 mt-2">
						<button onclick={() => (step = 2)} class="wr-btn wr-btn-secondary flex-1">
							重新选择
						</button>
						<button
							onclick={handleCreate}
							class="wr-btn wr-btn-primary flex-1"
							disabled={!title.trim() || createLoading}
						>
							{#if createLoading}
								<span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
								创建中...
							{:else}
								创建房间
							{/if}
						</button>
					</div>
				</div>
			</div>

			<button onclick={() => (step = 2)} class="mt-4 text-sm" style="color: var(--wr-text-medium)">
				← 重新选择影片
			</button>
		{/if}
	{/if}
</div>
