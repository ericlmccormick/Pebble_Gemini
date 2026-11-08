#!/usr/bin/env python3
"""WISP small-screen agent artwork source, based on the approved generated concepts.
Atlas strips in order: WISP, Gemini, ChatGPT/OpenAI, Claude, Grok,
Muse, OpenRouter, DeepSeek. Original artwork is simplified to 40px for
Pebble resource budgets. Full launcher icon stays the WISP app icon.
"""
from pathlib import Path
from PIL import Image
import base64
import zlib

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'resources'/'images'
BRANDING=ROOT/'branding'
NAMES=['wisp','gemini','openai','claude','grok','muse','openrouter','deepseek']
ATLAS_B85 = """c-rlqv5F*B6o#vMClF*117X=nWDSIU0^dLoF*H!Y#7OWV#MnqMF!TX75Dbh=1QRpgz{J>Sc6Vkx)Bp6(-{;(W>sHmRa(bo?MN?aSyLY>{zy8np@42_TZi_9pcp%Zsk-M@*`*(bcEmrvuZ6CLmvD@w3$rf9ThxazlUVHuNmp>*CyDRySlP9R_ADun2Lr>Ox-*@}iK80IM{ty+gjmP10*WUwjbEq1{OGvFnf2_P8zyIvzKJ3KF@y7KQH8Bd_V=eAa8eW{d`|Q0>zWU<(KcC~UbHKX<!ma`_JdNDzeb@=<?(asTv)etwEl#$$dj)SllqZ)MKV5_YuMuj%zIyfQ`Z(;0QLK#5f1`~}Q&>A7sk{ZhkYK$FgCWZOVt5w7#9eQmzxCnMuiGO0_W5HwHUj6T%{grC+#NZPmq2*wyb)<L;8kWF$Pi*4b6$?!{`JdGcv?H*3sn8J>$uV%l4@{m=Y2bOD@UTcPI$lj<_Ejwl_v4g?wK7Mfera(K0M@K`C_>(zxb4X@a=Oux&<s*I#hNJc!8~<YFRW6LJbLSWl|ZQ5LrdlaZP@45rbV_+=^VIl1EIKG2q3E7bd=K;RU~+e*RhW5A=0K+{@y3R28h_mvDIO_K$!5U4mcLP~(*F+PND^ob3dMolllv=EKaB=~hL4b0cTI6$B8H`XYqWS-@)-7lPN0wi0|@9rsd;BfOeC=Y+Uz=FF7x>gsCGFOtk%LwN0$NUF$cl586794-1<k@T8EfVQ)$DzoUASCd>PzWqFSbL2XT39m)NviC`MPIC3Ii+0y)@ZP+oKWC47lt_043u__s8K2%ap1foHngrX)u8{--Oal-VE_j6gLRhJ-N-j>~A1i$={g;zshj7&2I6&Qiek#0{21itR@S+VPylpdQ@aqu9m5tw460GJ`)M7Vmx#an3AFWbo!pr|b$8UjL7RAak9#T%HIXy(fnSXThs{Ar@#vl7*cqhCSNq7ON4x>*+cp=2%8=TdH{Py|dza^a2oXelfk6MS{6)0XNhrj(^H&lQ9?e~j|i}<STqTMC%_DjGE@g=|WB^b?AMjY*BxK&Pnkx@Hx9igzcFtQA9(nIE}P)J{<f^)%y7ZXVUyuN!?D_K%W43QgahO8rRu6Ji3+D=Bj=SH7?axO0~Bf=408>Wx4C%J$8E>MQ|w3H1`KKa$<<%PtRythJeOWPSi@kI&^gy*QRTFp>iXFfY^Rp*M&Kw2r#WeHYeS=%#E;W~t4h`ZH8vh9I9>T6-J>1x}U5=V`;a~o{8ICx&q@1+D_RD>PBP+pME7{%`>gjeI&J?#QcTF>GagaTW;#i2O!E@*MXnIo!<(Ry_pm`KvDhOx6n&`l~YxU=h#U&5<pGP7%-3JD&?FGW@<W)`hiz^Pi(j$HCvBf*Z!oRb{kMIx=d17T1+SP?@>T{u0pf>&$a2yargmzzIo$Zz3mA@@x(6JE%!BNvC=Wt_U}q<AL6njhM2gjW%U3XgT9UFB=sIYlPF^p**`He%7cCckv83-2u4DizsyPCbn#e1vyYI~FLTH<j$cNLI&oQ6GiM_lVzOI&FomgE5J40bY(@Vvcw@eg|dUAw2spy;WZ5X(ZI(#W*{ObfZR|hOld|GB!1Bc7ZIKwQ%wo>iI?ghU1r|uI9;+;(GmcFP6gU<d_q_Zkox#t6i6s)`P2jlj57Rwv>82kosHGh~@ZY37kYy2kXey_-&F%Cpj%69OZZ<#kV!DgIAw$&+m<rXkE-)niL=Af=8>c@n}>Q$c-v|OYv@;{-RYw_1ERk-Jvh53yT``g#%k8+m+-x_gF!84pmZr9k#lBsh^iTC*ftnd<_0seexXjG}gkTGAgwWUQK`7!dqWu=c@90egUTQsW4jvx0(72PEjUvBqaDStglzzdTf(IEE)AcF3mn?n$L8la`V5P^jIRP=15Ja2j_qL@JGCMn$p@rS=MeIl;gn?*x~8WD=2RiZu(c1Q%K4$7>u0aV&vM%@mLFMeSRm~Q)O4JQhcNA9`y8vS>+e!;5wRG^>#G*oq+HJeq9Q!t`sw5>aTOXK)oA`7)+k~W5LCthLu~zkehyr<`oexvtQsh39n0x;aV%a^)tV8pAhh%9GLM0Qmft<_?_R{F%99#Y4ae(m6mvY<qHkv%rElc6u&)n8H4%oY12t)waVF6IdVtk&lFQlm?@*sR=ahp_^H3-os}=I6eQS9{<?{w<PwIY{ne0P=FiC)VTBjol%4C$(V%CQt7la}bEU4!lU@3~&N9P>W$(0@z^~fQ01#I5p#H+Mf_zVNu_pUh-AMmRdDMEA7^=4n9$5%8>t?m9)^tIFldBaR#fADe`Ce%jJ!nDey4_g+Cfhk&7YE3luzsPO04L{(;+X%}f}Sba6X1<cSYP}yXGVEj$uGvE5T5Bm^V3_NKccHMc144t$0n=jO6g#XC#`YTNmo6T`Bi4=B=at9Z*~?myRA4ETqv%OzpT#4pe|T|$U1m)<f{KXY6*kmH`3>-<Cr1i893(7^6MTrt&_xM*AvVut$A0|-}?Ryi0@9gnAU&gRvWRN<t-_uVWnLh&b2P{s|d&0A6n3E6`}uB94F7ZYey+<KETVo*GaIO7-EpzB=z<DM)S%IFk0DNsZCjS0{;ppI;LAI+ICJZxs1`z{6bRe>tBfV%=$NpaO|Ii;Lhxyq<>{6w5QaSVj~ByD8EdqYx3uUL~2Jg{~uMCwL>!5zfoEC-stAuF5c~De~d(hmwptm<pEj;TefQWEi_PZodR~z0j(^GaTg8hHThj4mRW$D@Sj1V-BO(k{xfbT_|Jm~>-vQzO9%@sSe-0M&}}zJy6Uff30Szv;&OrDGHUu)t~*PK&Z%&LUlm`vQVJ>IwULS~uDF@s3F`;dd>)ie6JijWlP75L*o8<BCXVKRiEx<z?UVDrG`_~p{|+LoS#*>2gWAH8+-)OnVTW8={b!1`P9oQ|aB$j}YZ-L%NIfo1s<~|6tzW3wh=crc(SfcC+(UiFZF3x(t_yms_zo7oI#SmtQE;Ki5M>m<b9TDBo)M?OZ%+>@-+$F<rQEjvsw}~`;@e^)JE)}F?TU`HD};5~k=oSiTB8=OU&5b+w>w_o;D*tiwl}svtRJlWmW)}k7PC&B0jb-XW2|kJ;};~-p>nk?24h%vSd^qI`oZ=3@SYCBw^guPw!ro(dRcAzpUa<i?4M)&&MA8xzgz-b*lm*YMBGcq@vCNa4ZOO;bA(ryAnDFIar2ED+qn<`Q>T;M798>7v^_UmOO;Uxw+dw}!maQnxw(CHNcYO{o;t$NVpP6SbDOL`Dj?i^|2nsj(1n{qiX}5-nv=!5ku%+HhpX<;n&nW9O3j3MY#zd1M=<M*sY2AZT9wT!7QeC1r9&0TrT7}NbGFubNc{F{L?_c}C6~qTayvhF%j_SkwlfM|OdD}hSnFa}?P`Pcs2$xY!EO$y%j^)VVvVA>o3ZB=GG{jj#NG_2x%8hWZ+Jyc<Gd}Whg`NixQpH7{>cXbZ>P(P+$I|<@4u0oPHOzL@(*T`Oxqba>(*GBRCm&&)ucwy<%DWXMO~g|F2t?Z9hgZMYvyis;53)<=C-g~$YFi}@E&zRGhr_5e|73VUdDE4BIy<h#=P1+WZE08YkRxUU8%hpYF1C%`5D$zPEV7@)M~$Q#KaiKHaFB{3W-Y?a7S_f$?kOFjiwf;bjypV#bc}8+KlIrQM)cmeOsAqPy4%JDR-^6Uf<$Q!OQjg$6Gr0L!Z8T_2b>Fi}lwQrd7LRi(<?Qx%X7hw;vDPqRj8{hV6ae)E)OTlARc9{)%_9OzyW2=@#SCx`!KF^NV8za{J|fW^s#$f$jE9zr_|?Y_Y`_?c+a;VOo#"""


def remove_flat_background(crop):
    """Only remove edge-connected pixels matching the original matte.

    Avoid removing enclosed white/black pieces of the actual agent symbol.
    Input is the approved atlas artwork, not an untrusted new logo.
    """
    from collections import deque
    rgb = crop.convert('RGB')
    w,h=rgb.size
    pixels=rgb.load()
    corners=[pixels[x,y] for x,y in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]]
    # The corner colors of the original artwork define its matte.
    bg=max(set(corners), key=corners.count)
    def dist(p):
        return sum((p[k]-bg[k])**2 for k in range(3))
    tolerance=42*42*3
    visited=set()
    q=deque()
    for x in range(w):
        for y in (0,h-1):
            if dist(pixels[x,y])<=tolerance: q.append((x,y))
    for y in range(h):
        for x in (0,w-1):
            if dist(pixels[x,y])<=tolerance: q.append((x,y))
    while q:
        x,y=q.popleft()
        if (x,y) in visited or not 0<=x<w or not 0<=y<h: continue
        if dist(pixels[x,y])>tolerance: continue
        visited.add((x,y))
        q.extend(((x-1,y),(x+1,y),(x,y-1),(x,y+1)))
    alpha=Image.new('L',(w,h),255)
    ap=alpha.load()
    for x,y in visited: ap[x,y]=0
    out=rgb.convert('RGBA')
    out.putalpha(alpha)
    return out

def make_readable_icon(crop, mono=False):
    """Transparent high-contrast outline supports either day/night canvas."""
    from PIL import ImageFilter
    rgba=remove_flat_background(crop)
    mask=rgba.getchannel('A')
    # Outer dark pixel and inner light pixel create a two-tone edge around
    # colorful and monochrome logos, regardless of the chosen watch theme.
    outer=mask.filter(ImageFilter.MaxFilter(5))
    middle=mask.filter(ImageFilter.MaxFilter(3))
    result=Image.new('RGBA',rgba.size,(0,0,0,0))
    dark=Image.new('RGBA',rgba.size,(0,0,0,255))
    light=Image.new('RGBA',rgba.size,(255,255,255,255))
    result.paste(dark,(0,0),outer)
    result.paste(light,(0,0),middle)
    if mono:
        # White silhouette, black outline remains legible in both themes.
        result.paste(light,(0,0),mask)
    else:
        result.paste(rgba,(0,0),mask)
    return result

def main():
    source=Image.frombytes('RGB',(40*len(NAMES),40),
        zlib.decompress(base64.b85decode(''.join(ATLAS_B85.split()))))
    OUT.mkdir(parents=True,exist_ok=True)
    BRANDING.mkdir(parents=True,exist_ok=True)
    for idx,name in enumerate(NAMES):
        crop=source.crop((40*idx,0,40*(idx+1),40))
        color=make_readable_icon(crop,mono=False)
        mono=make_readable_icon(crop,mono=True)
        color.save(OUT/f'agent_{name}_color.png',optimize=True)
        mono.save(OUT/f'agent_{name}_mono.png',optimize=True)
        if name not in ('openrouter','deepseek'):
            color.resize((80,80),Image.Resampling.NEAREST).save(
                BRANDING/f'concept_{name}_80.png',optimize=True)
    print('Generated 8 transparent RGBA agent icons, color + outlined mono, 40x40px')

if __name__=='__main__':
    main()
