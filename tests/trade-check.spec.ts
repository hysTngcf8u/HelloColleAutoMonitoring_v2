import { test, expect } from '@playwright/test';
import axios from 'axios';

test('ハロコレ監視 V2 (GAS連動版)', async ({ page }) => {
    // --- スマホサイズ（縦長）に強制設定 ---
    await page.setViewportSize({ width: 375, height: 812 });

    const GAS_URL = process.env.GAS_WEBAPP_URL;
    const MY_ID = process.env.MY_USER_ID;
    const MY_PASS = process.env.MY_PASSWORD;
    const MY_HCID = process.env.MY_HC_ID;

    let capturedTrades: any[] = [];
    let capturedCollection: any[] = [];

    // 通信傍受
    page.on('response', async (res) => {
        const url = res.url();
        try {
            if (url.includes('/trades') && url.includes('type=sender')) {
                const json = await res.json();
                capturedTrades = json.data || json;
                console.log('✅ トレード履歴APIを捕捉');
            }
            if (url.includes('/member_cards')) {
                const json = await res.json();
                capturedCollection = json.data || json;
                console.log('✅ 所持カードAPIを捕捉');
            }
        } catch (e) {}
    });

    // 1. ログイン処理
    console.log('[Step 1] ログインを開始します...');
    await page.goto('https://helloproject.orical.jp/login/helloproject');
    
    // 「横向き禁止」の画面を隠すための処理
    await page.addStyleTag({ content: '.t-prohibit-landscape { display: none !important; }' });

    await page.waitForSelector('input[type="number"]', { timeout: 10000 });
    
    console.log('IDとパスワードを入力中...');
    await page.locator('input[type="number"]').fill(MY_ID!);
    await page.locator('input[type="password"]').fill(MY_PASS!);

    console.log('ログインボタンをクリックします...');
    const loginButton = page.getByRole('button', { name: /ログイン/i }).or(page.locator('button[type="submit"]'));
    
    // force: true を追加して、重なっている要素があっても強制的にクリック
    await loginButton.click({ force: true });

    // ログイン後の遷移を待機
    try {
        await page.waitForURL(/\/home/, { timeout: 30000 }); 
        console.log('✅ ホーム画面への遷移に成功');
    } catch (e) {
        console.error('❌ ログイン遷移失敗。現在のURL:', page.url());
        throw e;
    }

    // 2. コレクション取得
    console.log('[Step 2] マイページへ移動...');
    await page.goto(`https://helloproject.orical.jp/mypage/${MY_HCID}`);
    await page.waitForTimeout(5000);
    // スクロールしてデータを読み込ませる
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(2000);

    // 3. トレード履歴取得
    console.log('[Step 3] ホームへ移動...');
    await page.goto('https://helloproject.orical.jp/home');
    await page.waitForTimeout(5000);

    // --- GASへのデータ送信処理 ---
    if (!GAS_URL) return;

    if (capturedCollection.length > 0) {
        const collectionData = capturedCollection.map(item => ({
            name: item.card?.description || item.card?.person?.name || "不明",
            stars: '★'.repeat(item.card?.rarity || 1),
            series: item.card?.name || "-",
            amount: item.amount
        }));
        await axios.post(GAS_URL, { type: 'collection', data: collectionData }).catch(() => {});
        console.log('GASへコレクション送信完了');
    }

    if (capturedTrades.length > 0) {
        const tradeData = capturedTrades.map(t => ({
            appliedAt: t.created_at,
            status: t.status === 'pending' ? '申請中' : (t.status === 'accepted' ? '成立' : '不成立'),
            partnerId: t.receiver_partner_user?.screen_name || '不明',
            mainCard: {
                member: t.request_card_user?.card?.description || "不明",
                stars: '★'.repeat(t.request_card_user?.card?.rarity || 1),
                series: t.request_card_user?.card?.name || "-"
            }
        }));

        const res = await axios.post(GAS_URL, { type: 'trade', data: tradeData });
        
        if (res.data && res.data.shouldNotify && res.data.report) {
            const message = res.data.report;
            if (process.env.DISCORD_WEBHOOK_URL) await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message });
            if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_USER_ID) {
                await axios.post('https://api.line.me/v2/bot/message/push', {
                    to: process.env.LINE_USER_ID,
                    messages: [{ type: 'text', text: message }]
                }, {
                    headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
                }).catch(() => {});
            }
        }
    }
    console.log('全工程完了');
});