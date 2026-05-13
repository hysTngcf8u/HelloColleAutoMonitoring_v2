import { test } from '@playwright/test';
import axios from 'axios';

const USER_ID = process.env.MY_USER_ID || '';
const USER_PW = process.env.MY_PASSWORD || '';
const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL || '';
const GAS_URL = process.env.GAS_WEBAPP_URL || '';

test('Trade Monitoring via GAS', async ({ page }) => {
    console.log('[Step 1] ハロコレにログイン中...');
    await page.goto('https://helloproject.orical.jp/login');
    await page.fill('input[name="screen_name"]', USER_ID);
    await page.fill('input[name="password"]', USER_PW);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/mypage');

    console.log('[Step 2] トレード情報を取得中...');
    const responsePromise = page.waitForResponse(res => res.url().includes('/api/trades/history'));
    await page.goto('https://helloproject.orical.jp/mypage/beyomiyo_reirei');
    const response = await responsePromise;
    const json = await response.json();
    const capturedTrades = json.trades || [];

    const statusMap: Record<string, string> = {
        pending: '申請中', accepted: '成立', rejected: '不成立', cancelled: 'キャンセル'
    };

    console.log(`[Step 3] ${capturedTrades.length}件のデータをGASへ送信中...`);

    for (const t of capturedTrades) {
        const receiver = t.receiver_partner_user || {};
        const rcUser = t.request_card_user || {};
        const card = rcUser.card || {};

        const tradeData = {
            tradeId: String(t.id),
            status: statusMap[t.status] || t.status,
            appliedAt: t.created_at || '',
            partnerId: receiver.screen_name || '不明',
            mainCard: {
                member: card.description || card.person?.name || "不明",
                stars: '★'.repeat(Number(card.rarity || 1)),
                series: card.name || "-",
                partnerPossession: rcUser.amount !== undefined ? String(rcUser.amount) : "-"
            }
        };

        // GASにデータを送信して、通知が必要か判断してもらう
        try {
            const gasRes = await axios.post(GAS_URL, tradeData);
            if (gasRes.data.shouldNotify) {
                const icon = tradeData.status === '成立' ? '✅' : '❌';
                const msg = `${icon} トレード【${tradeData.status}】\n` +
                            `カード: ${tradeData.mainCard.member} ${tradeData.mainCard.stars}\n` +
                            `シリーズ: ${tradeData.mainCard.series}\n` +
                            `相手: ${tradeData.partnerId}`;
                
                await axios.post(DISCORD_URL, { content: msg });
                console.log(`通知送信: ${tradeData.mainCard.member}`);
            }
        } catch (e) {
            console.error('GAS送信エラー:', e.message);
        }
    }
    console.log('[完了] 全データの処理が終わりました。');
});