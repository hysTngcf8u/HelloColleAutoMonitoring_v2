import { test, devices } from '@playwright/test';
import axios from 'axios';

test('ハロコレ監視 V2 (GAS連動版)', async ({ page }) => {
    let capturedTrades: any[] = [];
    let capturedCollection: any[] = [];

    // 通信傍受ロジック（V1の条件を維持）
    page.on('response', async (res) => {
        const url = res.url();
        try {
            if (url.includes('/trades') && url.includes('type=sender')) {
                const json = await res.json();
                capturedTrades = json.data || json;
            }
            if (url.includes('/member_cards')) {
                const json = await res.json();
                capturedCollection = json.data || json;
            }
        } catch (e) {}
    });

    // 1. ログイン処理
    await page.goto('https://helloproject.orical.jp/login');
    await page.getByRole('spinbutton').fill(process.env.MY_USER_ID!);
    await page.getByRole('textbox').fill(process.env.MY_PASSWORD!);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/home/, { timeout: 15000 });

    // 2. コレクション取得（V1の手順を維持）
    await page.goto(`https://helloproject.orical.jp/mypage/${process.env.MY_USER_ID}`);
    await page.waitForTimeout(5000); // 読込待ち

    // 3. トレード取得（ホームへ戻る）
    await page.goto('https://helloproject.orical.jp/home');
    await page.waitForTimeout(5000);

    // --- GASへのデータ送信 ---
    const GAS_URL = process.env.GAS_WEBAPP_URL!;

    // コレクション送信
    if (capturedCollection.length > 0) {
        const collectionData = capturedCollection.map(item => ({
            name: item.card?.description || item.card?.person?.name || "不明",
            stars: '★'.repeat(item.card?.rarity || 1),
            series: item.card?.name || "-",
            amount: item.amount
        }));
        await axios.post(GAS_URL, { type: 'collection', data: collectionData });
    }

    // トレード送信 ＆ 通知判断
    if (capturedTrades.length > 0) {
        const tradeData = capturedTrades.map(t => ({
            appliedAt: t.created_at,
            status: t.status === 'pending' ? '申請中' : t.status === 'accepted' ? '成立' : '不成立',
            partnerId: t.receiver_partner_user?.screen_name || '不明',
            mainCard: {
                member: t.request_card_user?.card?.description || "不明",
                stars: '★'.repeat(t.request_card_user?.card?.rarity || 1),
                series: t.request_card_user?.card?.name || "-"
            }
        }));

        const res = await axios.post(GAS_URL, { type: 'trade', data: tradeData });
        
        // GASが「通知してよし」と言った場合のみDiscordへ
        if (res.data.shouldNotify && process.env.DISCORD_WEBHOOK_URL) {
            await axios.post(process.env.DISCORD_WEBHOOK_URL, { 
                content: "🔄 トレード状況に変化がありました！スプレッドシートを確認してください。" 
            });
        }
    }
});