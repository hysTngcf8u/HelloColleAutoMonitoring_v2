import fs from 'fs';
import path from 'path';

const JSON_FILE = 'my_collection.json';
const CSV_FILE = 'my_collection.csv';

function convert() {
    if (!fs.existsSync(JSON_FILE)) return;
    const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
    
    // データ構造に合わせて調整が必要ですが、一般的な例を記載します
    let csvContent = "\uFEFFカード名,星,シリーズ,枚数\n";
    const rows = data.map((item: any) => {
        const card = item.card || item;
        return [
            `"${card.description || card.person?.name || ""}"`,
            `"${'★'.repeat(card.rarity || 1)}"`,
            `"${card.name || ""}"`,
            `"${item.amount || 1}"`
        ].join(",");
    });

    csvContent += rows.join("\n");
    fs.writeFileSync(CSV_FILE, csvContent);
    console.log("所持カードCSVを更新しました。");
}
convert();