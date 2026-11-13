import { cards } from './cards';
import { markerSVG } from './geometry';
const selected=new URLSearchParams(location.search).get('card');
document.getElementById('print-cards')!.onclick=()=>window.print();
async function prepare(){
  for(const card of cards.filter(c=>!selected||c.key===selected)){
    const article=document.createElement('article'),canvas=document.createElement('canvas');canvas.width=600;canvas.height=720;canvas.dataset.card=card.key;canvas.dataset.markerId=String(card.id);
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,600,720);ctx.fillStyle='#152b35';ctx.textAlign='center';ctx.font='bold 34px sans-serif';ctx.fillText(card.name,300,43);ctx.font='20px sans-serif';ctx.fillText(`AR CARD LAB / ID ${card.id}`,300,78);
    const url=URL.createObjectURL(new Blob([markerSVG(card.id)],{type:'image/svg+xml'}));
    try{const image=new Image();image.src=url;await image.decode();ctx.drawImage(image,0,90,600,600);}finally{URL.revokeObjectURL(url);}
    const hint=document.createElement('p');hint.textContent=card.hint;const actions=document.createElement('div');actions.className='actions';
    const download=document.createElement('button');download.textContent='個別PNGを保存';download.onclick=()=>canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ar-card-${card.key}-${card.id}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    const show=document.createElement('a');show.href=`ar-cards.html?card=${card.key}`;show.textContent='このカードを大きく表示';actions.append(download,show);article.append(canvas,hint,actions);document.getElementById('cards')!.append(article);
  }
  document.getElementById('card-page-status')!.textContent=selected&&!cards.some(c=>c.key===selected)?'指定されたカードはありません。':'準備できました。白い余白を切り落とさないでください。';
}
void prepare().catch(()=>{document.getElementById('card-page-status')!.textContent='カード生成に失敗しました。再読込してください。';});
