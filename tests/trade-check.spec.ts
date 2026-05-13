import { test, expect } from '@playwright/test';
import axios from 'axios';
import fs from 'fs';

test('ハロコレ監視 V2 (GAS連動版)', async ({ page }) => {
    // --- 環境変数の読み込み ---
    const GAS_URL = process.env.GAS_WEBAPP_URL;
    const MY_ID = process.env.MY_USER_ID;
    const MY_PASS = process.env.MY_PASSWORD;
    const MY_HCID = process.env.MY_HC_ID;

    let capturedTrades: any[] = [];
    let capturedCollection: any[] = [];

    // --- 通信傍受の設定 ---
    page.on('response', async (res) => {
        const url = res.url();
        try {
            // トレード履歴APIの捕捉
            if (url.includes('/trades') && url.includes('type=sender')) {
                const json = await res.json();
                capturedTrades = json.data || json;
                console.log('✅ トレード履歴APIを捕捉しました');
            }
            // 所持カードAPIの捕捉
            if (url.includes('/member_cards')) {
                const json = await res.json();
                capturedCollection = json.data || json;
                console.log('✅ 所持カードAPIを捕捉しました');
            }
        } catch (e) {
            // JSONでない通信などは無視
        }
    });

    // 1. ログイン処理
    console.log('[Step 1] ログインを開始します...');
    await page.goto('https://helloproject.orical.jp/login');
    
    // ログインフォームへの入力
    // サイトの仕様でリダイレクトされる場合があるため、少し待機してから入力
    await page.waitForSelector('input[type="number"], input[type="password"]', { timeout: 10000 });
    await page.locator('input[type="number"]').fill(MY_ID!);
    await page.locator('input[type="password"]').fill(MY_PASS!);
    
    console.log('ログインボタンをクリックします...');
    await Promise.all([
        page.keyboard.press('Enter'),
        page.waitForURL(/\/home/, { timeout: 20000 }) // ホーム画面に遷移するまで待つ
    ]);

    // 2. コレクション取得
    console.log('[Step 2] 所持カード情報を取得するためマイページへ移動...');
    await page.goto(`https://helloproject.orical.jp/mypage/${MY_HCID}`);
    
    // データが流れてくるのを待つためにスクロール
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(2000);

    // 3. トレード履歴取得
    console.log('[Step 3] トレード履歴を確定させるためホームへ移動...');
    await page.goto('https://helloproject.orical.jp/home');
    await page.waitForTimeout(5000);

    // --- GASへのデータ送信処理 ---
    if (!GAS_URL) {
        console.error('❌ GAS_WEBAPP_URL が設定されていません。');
        return;
    }

    // A. コレクションデータの送信
    if (capturedCollection.length > 0) {
        const collectionData = capturedCollection.map(item => ({
            name: item.card?.description || item.card?.person?.name || "不明",
            stars: '★'.repeat(item.card?.rarity || 1),
            series: item.card?.name || "-",
            amount: item.amount
        }));
        await axios.post(GAS_URL, { type: 'collection', data: collectionData }).catch(e => console.error('GAS送信失敗(Col)'));
        console.log('GASへコレクションデータを送信しました。');
    }

    // B. トレード履歴の送信と通知判断
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
        
        // GAS側で「通知が必要（新規 or 変化あり）」と判断された場合のみ通知
        if (res.data && res.data.shouldNotify && res.data.report) {
            const message = res.data.report;

            // Discord通知
            if (process.env.DISCORD_WEBHOOK_URL) {
                await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message });
            }

            // LINE通知
            if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_USER_ID) {
                await axios.post('https://api.line.me/v2/bot/message/push', {
                    to: process.env.LINE_USER_ID,
                    messages: [{ type: 'text', text: message }]
                }, {
                    headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
                }).catch(() => console.error('LINE送信失敗'));
            }
        }
    }
    
    console.log('すべての処理が完了しました。');
});