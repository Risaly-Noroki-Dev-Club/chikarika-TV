<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/utils/api';

	let connections = $state<any[]>([]);
	let isLoading = $state(true);
	let showAdd = $state(false);
	let baseUrl = $state('');
	let apiKey = $state('');
	let addError = $state('');
	let addLoading = $state(false);
	let testingId = $state<string | null>(null);

	onMount(async () => {
		await loadConnections();
	});

	async function loadConnections() {
		try {
			const res = await api<{ connections: any[] }>('/api/emby/connections');
			connections = res.connections;
		} catch {
			// ignore
		} finally {
			isLoading = false;
		}
	}

	async function handleAdd(e: SubmitEvent) {
		e.preventDefault();
		addError = '';
		addLoading = true;

		try {
			await api('/api/emby/connections', {
				method: 'POST',
				body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
			});
			showAdd = false;
			baseUrl = '';
			apiKey = '';
			await loadConnections();
		} catch (err: any) {
			addError = err.message;
		} finally {
			addLoading = false;
		}
	}

	async function testConnection(id: string) {
		testingId = id;
		try {
			const res = await api<{ ok: boolean; serverName: string }>(`/api/emby/connections/${id}/test`, {
				method: 'POST',
			});
			alert(`连接成功: ${res.serverName}`);
		} catch (err: any) {
			alert(`连接失败: ${err.message}`);
		} finally {
			testingId = null;
		}
	}

	async function deleteConnection(id: string) {
		if (!confirm('确定要删除这个 Emby 连接吗？')) return;
		await api(`/api/emby/connections/${id}`, { method: 'DELETE' });
		await loadConnections();
	}
</script>

<div class="wr-fade-in">
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-xl font-bold">Emby 连接</h1>
		<button onclick={() => (showAdd = !showAdd)} class="wr-btn wr-btn-primary text-sm">
			{showAdd ? '取消' : '添加连接'}
		</button>
	</div>

	{#if showAdd}
		<div class="wr-card p-6 mb-6">
			<h2 class="font-medium mb-4">添加 Emby 连接</h2>
			<form onsubmit={handleAdd} class="flex flex-col gap-4">
				{#if addError}
					<div class="rounded-md px-4 py-3 text-sm" style="background: rgba(255, 180, 171, 0.1); color: var(--wr-error)">
						{addError}
					</div>
				{/if}
				<div>
					<label for="baseUrl" class="wr-label">Emby 服务器地址</label>
					<input
						id="baseUrl"
						type="url"
						class="wr-input"
						placeholder="https://emby.example.com"
						bind:value={baseUrl}
						disabled={addLoading}
					/>
				</div>
				<div>
					<label for="apiKey" class="wr-label">API Key</label>
					<input
						id="apiKey"
						type="password"
						class="wr-input"
						placeholder="Emby API Key"
						bind:value={apiKey}
						disabled={addLoading}
					/>
					<p class="mt-1 text-xs" style="color: var(--wr-text-disabled)">
						在 Emby 管理面板 → 高级 → API 密钥 中获取
					</p>
				</div>
				<button
					type="submit"
					class="wr-btn wr-btn-primary"
					disabled={!baseUrl.trim() || !apiKey.trim() || addLoading}
				>
					{#if addLoading}
						<span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
						测试并保存...
					{:else}
						测试并保存
					{/if}
				</button>
			</form>
		</div>
	{/if}

	{#if isLoading}
		<div class="flex justify-center py-12">
			<span class="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style="color: var(--wr-primary)"></span>
		</div>
	{:else if connections.length === 0 && !showAdd}
		<div class="wr-card p-8 text-center">
			<p style="color: var(--wr-text-medium)">还没有绑定 Emby 服务器</p>
			<p class="mt-2 text-sm" style="color: var(--wr-text-disabled)">添加 Emby 连接后，你可以从你的媒体库选择影片创建观影房间</p>
		</div>
	{:else}
		<div class="grid gap-3">
			{#each connections as conn}
				<div class="wr-card p-4 flex items-center justify-between">
					<div>
						<h3 class="font-medium">{conn.serverName || '未命名服务器'}</h3>
						<p class="text-sm mt-1" style="color: var(--wr-text-medium)">{conn.baseUrl}</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => testConnection(conn.id)}
							class="text-xs px-3 py-1.5 rounded-md transition-colors"
							style="color: var(--wr-primary); border: 1px solid var(--wr-border);"
							disabled={testingId === conn.id}
						>
							{testingId === conn.id ? '测试中...' : '测试'}
						</button>
						<button
							onclick={() => deleteConnection(conn.id)}
							class="text-xs px-3 py-1.5 rounded-md transition-colors"
							style="color: var(--wr-error); border: 1px solid var(--wr-border);"
						>
							删除
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
