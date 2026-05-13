import { test } from '@playwright/test';
import axios from 'axios';

const USER_ID = process.env.MY_USER_ID || '';
const USER_PW = process.env.MY_PASSWORD || '';
const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL || '';
const GAS_URL = process.env.GAS_WEBAPP_URL || '';

import { test } from '@playwright/test';
import axios from 'axios';

const USER_ID = process.env.MY_USER_ID || '';
const USER_PW = process.env.MY_PASSWORD || '';
const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL || '';
const GAS_URL = process.env.GAS_WEBAPP_URL || '';

// 全体のタイムアウトを90秒に設定
test.setTimeout(90000);

test('Trade Monitoring via GAS', async ({ page }) => {
    try {
        console.log('[Step 1] ハロコレにログイン中...');
        // ページ読み込み完了を待つ (networkidle: 通信が落ち着くまで待機)
        await page.goto('https://helloproject.orical.jp/login', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });

        // 入力欄が表示されるまで待つ
        await page.waitForSelector('input[name="screen_name"]', { state: 'visible', timeout: 30000 });
        
        await page.fill('input[name="screen_name"]', USER_ID);
        await page.fill('input[name="password"]', USER_PW);
        await page.click('button[type="submit"]');

        // マイページへの遷移を待つ
        await page.waitForURL('**/mypage', { timeout: 30000 });

        console.log('[Step 2] トレード情報を取得中...');
        const responsePromise = page.waitForResponse(
            res => res.url().includes('/api/trades/history'),
            { timeout: 30000 }
        );

        // トレード履歴ページへ移動（伏せ字部分はご自身のコードのままでOKです）
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

    } catch (error) {
        console.error('エラー発生:', error.message);
        // エラー時のスクリーンショットを保存（ActionsのArtifactsで確認可能）
        await page.screenshot({ path: 'error-screenshot.png' });
        throw error;
    }
});