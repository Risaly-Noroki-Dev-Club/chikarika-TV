<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { api } from '$lib/utils/api';
	import { ws } from '$lib/utils/ws';
	import { user } from '$lib/stores/auth';
	import type { PlaybackState } from '@chikarika-tv/shared';

	let roomId = $derived($page.params.roomId);
	let room = $state<any>(null);
	let members = $state<any[]>([]);
	let messages = $state<any[]>([]);
	let playbackState = $state<PlaybackState | null>(null);
	let playbackUrl = $state<any>(null);

	let chatInput = $state('');
	let isLoading = $state(true);
	let error = $state('');
	let needsJoin = $state(false);
	let joinError = $state('');
	let joinLoading = $state(false);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let hlsInstance: any = null;
	let isSyncing = $state(false);
	let showChat = $state(true);
	let mediaEventSuppressedUntil = 0;
	let lastSeekSentAt = 0;

	// Cleanup functions
	let cleanupFns: Array<() => void> = [];

	onMount(async () => {
		try {
			if (!$user) {
				try {
					const auth = await api<{ user: any }>('/api/auth/me');
					user.set(auth.user);
				} catch {
					await goto('/login');
					return;
				}
			}

			// Load room info
			const res = await api<{ room: any; members: any[] }>(`/api/rooms/${roomId}`);
			room = res.room;
			members = res.members;

			if (room.status !== 'open') {
				error = '房间已关闭';
				isLoading = false;
				return;
			}

			const isMember = res.members.some((m: any) => m.userId === $user?.id);
			if (!isMember) {
				needsJoin = true;
				isLoading = false;
				return;
			}

			await enterRoom();

		} catch (err: any) {
			error = err.message;
			isLoading = false;
		}
	});

	onDestroy(() => {
		cleanupFns.forEach(fn => fn());
		if (roomId && !needsJoin) ws.send('room:leave', { roomId });
		if (hlsInstance) {
			hlsInstance.destroy();
		}
	});

	async function handleJoinRoom() {
		joinLoading = true;
		joinError = '';

		try {
			await api(`/api/rooms/${roomId}/join`, { method: 'POST' });
			const res = await api<{ room: any; members: any[] }>(`/api/rooms/${roomId}`);
			room = res.room;
			members = res.members;
			needsJoin = false;
			await enterRoom();
		} catch (err: any) {
			joinError = err.message || '加入房间失败';
		} finally {
			joinLoading = false;
		}
	}

	async function enterRoom() {
		try {
			// Load chat history before subscribing to new messages.
			const history = await api<{ messages: any[] }>(`/api/rooms/${roomId}/messages`);
			messages = history.messages;

			// Get playback URL
			const urlRes = await api<any>(`/api/rooms/${roomId}/playback-url`);
			playbackUrl = urlRes;

			// Connect WebSocket
			ws.connect();

			// Subscribe to events
			cleanupFns.push(
				ws.on('room:presence', (data) => {
					if (data.roomId === roomId) {
						members = data.members;
					}
				}),
				ws.on('room:member:joined', (data) => {
					if (data.roomId === roomId) {
						members = [...members.filter(m => m.userId !== data.userId), { userId: data.userId, displayName: data.displayName, online: true }];
					}
				}),
				ws.on('room:member:left', (data) => {
					if (data.roomId === roomId) {
						members = members.map(m => m.userId === data.userId ? { ...m, online: false } : m);
					}
				}),
				ws.on('room:closed', (data) => {
					if (data.roomId === roomId) {
						error = '房间已关闭';
					}
				}),
				ws.on('chat:new', (data) => {
					if (data.roomId === roomId) {
						messages = [...messages, data];
						scrollChat();
					}
				}),
				ws.on('system:message', (data) => {
					if (data.roomId === roomId) {
						messages = [...messages, { type: 'system', content: data.content, createdAt: new Date().toISOString() }];
						scrollChat();
					}
				}),
				ws.on('playback:state', (data) => {
					if (data.roomId === roomId) {
						playbackState = data;
						syncVideo(data);
					}
				}),
			);

			// Join room via WS
			ws.send('room:join', { roomId });

			isLoading = false;

			// Init player after load
			await initPlayer();
			scrollChat();
		} catch (err: any) {
			error = err.message;
			isLoading = false;
		}
	}

	async function initPlayer() {
		if (!playbackUrl || !videoEl) return;

		const url = playbackUrl.mode === 'proxy'
			? `${import.meta.env.PUBLIC_API_URL || 'http://localhost:2261'}${playbackUrl.url}`
			: playbackUrl.url;

		if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
			// Safari native HLS
			videoEl.src = url;
		} else {
			// Use hls.js
			const { default: Hls } = await import('hls.js');
			if (Hls.isSupported()) {
				hlsInstance = new Hls({
					maxBufferLength: 30,
					maxMaxBufferLength: 60,
				});
				hlsInstance.loadSource(url);
				hlsInstance.attachMedia(videoEl);
			}
		}
	}

	function syncVideo(state: PlaybackState) {
		if (!videoEl || isSyncing) return;
		isSyncing = true;
		mediaEventSuppressedUntil = Date.now() + 1000;

		const elapsed = state.playing ? Date.now() - state.serverTime : 0;
		const targetMs = state.positionMs + elapsed;
		const currentMs = videoEl.currentTime * 1000;
		const drift = Math.abs(currentMs - targetMs);

		if (drift > 1500) {
			videoEl.currentTime = targetMs / 1000;
		} else if (drift > 300) {
			videoEl.playbackRate = currentMs > targetMs ? 0.95 : 1.05;
			setTimeout(() => {
				if (videoEl) videoEl.playbackRate = 1.0;
			}, 2000);
		}

		if (state.playing && videoEl.paused) {
			videoEl.play().catch(() => {});
		} else if (!state.playing && !videoEl.paused) {
			videoEl.pause();
		}

		setTimeout(() => { isSyncing = false; }, 300);
	}

	function shouldIgnoreMediaEvent() {
		return isSyncing || Date.now() < mediaEventSuppressedUntil;
	}

	function handlePlay() {
		if (!videoEl || shouldIgnoreMediaEvent()) return;
		ws.send('playback:play', {
			roomId,
			positionMs: videoEl.currentTime * 1000,
			clientTime: Date.now(),
		});
	}

	function handlePause() {
		if (!videoEl || shouldIgnoreMediaEvent()) return;
		ws.send('playback:pause', {
			roomId,
			positionMs: videoEl.currentTime * 1000,
			clientTime: Date.now(),
		});
	}

	function handleSeek() {
		if (!videoEl || shouldIgnoreMediaEvent()) return;
		const now = Date.now();
		if (now - lastSeekSentAt < 750) return;
		lastSeekSentAt = now;
		ws.send('playback:seek', {
			roomId,
			positionMs: videoEl.currentTime * 1000,
			clientTime: Date.now(),
		});
	}

	function handleResync() {
		ws.send('playback:resync', { roomId });
	}

	function sendChat() {
		const content = chatInput.trim();
		if (!content) return;
		ws.send('chat:send', { roomId, content });
		chatInput = '';
	}

	function handleChatKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendChat();
		}
	}

	function scrollChat() {
		setTimeout(() => {
			const el = document.getElementById('chat-messages');
			if (el) el.scrollTop = el.scrollHeight;
		}, 50);
	}

	async function handleClose() {
		if (!confirm('确定要关闭房间吗？')) return;
		await api(`/api/rooms/${roomId}/close`, { method: 'POST' });
		await goto('/app');
	}

	function copyInviteLink() {
		const url = `${window.location.origin}/room/${roomId}`;
		navigator.clipboard.writeText(url).then(() => alert('已复制邀请链接'));
	}

	let isOwner = $derived(room?.ownerId === $user?.id);
	let onlineMembers = $derived(members.filter(m => m.online !== false));
</script>

<svelte:head>
	<title>{room?.title || 'chikarika-TV'}</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center min-h-screen">
		<span class="inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" style="color: var(--wr-primary)"></span>
	</div>
{:else if error}
	<div class="flex flex-col items-center justify-center min-h-screen gap-4 px-4">
		<p style="color: var(--wr-error)">{error}</p>
		<a href="/app" class="wr-btn wr-btn-secondary">返回首页</a>
	</div>
{:else if needsJoin}
	<div class="flex items-center justify-center min-h-screen px-4">
		<div class="wr-card wr-fade-in w-full max-w-[420px] p-8 text-center">
			<h1 class="text-xl font-bold">加入房间</h1>
			<p class="mt-2 text-sm" style="color: var(--wr-text-medium)">{room?.title}</p>
			<p class="mt-4 text-sm" style="color: var(--wr-text-disabled)">
				这个房间最多 2 人。加入后你将通过服务器代理观看房主的 Emby 片源。
			</p>
			{#if joinError}
				<div class="mt-4 rounded-md px-4 py-3 text-sm" style="background: rgba(255, 180, 171, 0.1); color: var(--wr-error)">
					{joinError}
				</div>
			{/if}
			<div class="mt-6 flex gap-3">
				<a href="/app" class="wr-btn wr-btn-secondary flex-1">取消</a>
				<button onclick={handleJoinRoom} class="wr-btn wr-btn-primary flex-1" disabled={joinLoading}>
					{#if joinLoading}
						<span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
						加入中...
					{:else}
						加入
					{/if}
				</button>
			</div>
		</div>
	</div>
{:else}
	<div class="h-screen flex flex-col md:flex-row overflow-hidden" style="background: var(--wr-bg);">
		<!-- Video section -->
		<div class="flex-1 flex flex-col min-w-0">
			<!-- Top bar -->
			<div class="flex items-center justify-between px-4 h-12 flex-shrink-0" style="background: var(--wr-surface); border-bottom: 1px solid var(--wr-border);">
				<div class="flex items-center gap-3 min-w-0">
					<a href="/app" class="text-sm flex-shrink-0" style="color: var(--wr-text-medium)">←</a>
					<h1 class="font-medium text-sm truncate">{room?.title}</h1>
					<span class="text-xs flex-shrink-0 px-2 py-0.5 rounded-full" style="background: rgba(138, 180, 248, 0.1); color: var(--wr-primary);">
						{playbackUrl?.mode === 'direct' ? '直连' : '代理'}
					</span>
				</div>
				<div class="flex items-center gap-2 flex-shrink-0">
					<button onclick={copyInviteLink} class="text-xs px-2 py-1 rounded" style="color: var(--wr-primary); border: 1px solid var(--wr-border);">
						复制邀请
					</button>
					<button onclick={() => (showChat = !showChat)} class="md:hidden text-xs px-2 py-1 rounded" style="color: var(--wr-text-medium); border: 1px solid var(--wr-border);">
						{showChat ? '隐藏聊天' : '聊天'}
					</button>
					{#if isOwner}
						<button onclick={handleClose} class="text-xs px-2 py-1 rounded" style="color: var(--wr-error); border: 1px solid var(--wr-border);">
							关闭房间
						</button>
					{/if}
				</div>
			</div>

			<!-- Video player -->
			<div class="flex-1 bg-black flex items-center justify-center relative">
				<!-- svelte-ignore element_invalid_self_closing_tag -->
				<video
					bind:this={videoEl}
					class="w-full h-full"
					onplay={handlePlay}
					onpause={handlePause}
					onseeked={handleSeek}
					controls
					playsinline
				/>
			</div>

			<!-- Playback controls bar -->
			<div class="flex items-center justify-between px-4 h-10 flex-shrink-0 text-xs" style="background: var(--wr-surface); border-top: 1px solid var(--wr-border);">
				<div class="flex items-center gap-3">
					<span style="color: var(--wr-text-medium)">
						{onlineMembers.length} 人在线
					</span>
					{#each onlineMembers as m (m.userId)}
						<span class="px-2 py-0.5 rounded-full" style="background: var(--wr-surface-3); color: var(--wr-text-medium);">
							{m.displayName}
						</span>
					{/each}
				</div>
				<button onclick={handleResync} class="px-2 py-1 rounded" style="color: var(--wr-secondary); border: 1px solid var(--wr-border);">
					重新同步
				</button>
			</div>
		</div>

		<!-- Chat sidebar -->
		{#if showChat}
			<div class="w-full md:w-80 flex flex-col flex-shrink-0 h-[40vh] md:h-auto" style="background: var(--wr-surface); border-left: 1px solid var(--wr-border);">
				<div class="px-4 h-10 flex items-center flex-shrink-0" style="border-bottom: 1px solid var(--wr-border);">
					<span class="text-sm font-medium" style="color: var(--wr-text-medium)">聊天</span>
				</div>

				<!-- Messages -->
				<div id="chat-messages" class="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
					{#each messages as msg, i (msg.id || `${msg.type}-${msg.createdAt}-${i}`)}
						{#if msg.type === 'system'}
							<div class="text-center text-xs py-1" style="color: var(--wr-text-disabled)">
								{msg.content}
							</div>
						{:else}
							<div class="flex flex-col gap-0.5">
								<span class="text-xs font-medium" style="color: var(--wr-primary)">{msg.displayName || '匿名'}</span>
								<p class="text-sm break-words" style="color: var(--wr-text-high)">{msg.content}</p>
							</div>
						{/if}
					{/each}
				</div>

				<!-- Chat input -->
				<div class="px-3 py-2 flex-shrink-0" style="border-top: 1px solid var(--wr-border);">
					<div class="flex gap-2">
						<input
							type="text"
							class="wr-input text-sm"
							placeholder="发送消息..."
							bind:value={chatInput}
							onkeydown={handleChatKey}
						/>
						<button
							onclick={sendChat}
							class="wr-btn wr-btn-primary text-sm px-4 flex-shrink-0"
							disabled={!chatInput.trim()}
						>
							发送
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
