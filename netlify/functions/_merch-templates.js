'use strict';
// Curated Fourthwall blanks for Merch Designs: tee, hoodie, poster, sticker, mug.
//
// Every id below was re-checked on 2026-11-25 with the public, no-key
// GET /open-api/v1.0/product-templates/{id} (supportsBackendRendering: true,
// minimumOrdersNumber: 0, not embroidery). Trimmed copies of those replies are
// in scripts/fixtures/fourthwall-blank-templates.json.
//
//   tee     pro_Vv1XdaPMSdm6jZ5pj24NCQ  Stanley/Stella Organic Ribbed Neck Tee, DTG, $15.85
//           (proven end to end on a real shop, owner's ~/fourthwall-merch).
//           front_large 2250 x 2700 @150 (15 x 18 in), placement largeCenter;
//           sleeves 600 x 525 suit the ES logo.
//           Alternates: pro_e4677535402b4eeb81 (Gildan Heavyweight, $9.50),
//           pro_EJBSRKhJSd2unv4ZnGKwdQ (AS Colour Premium, $16.32).
//   hoodie  pro_380  Cotton Heritage Unisex Premium Hoodie, DTG, $27.29, 21 colours.
//           front 1650 x 1650 @150 (11 x 11 in), placement largeCenter;
//           back_large 2250 x 2700; sleeves 450 x 1800 suit the ES logo.
//   poster  pro_15bc29bc8a324d449d  Enhanced Matte Paper Poster, PRINTED, from $5.50 (5 x 7 in).
//           One area "default" 1500 x 2100 @300 (5 x 7 in); bigger sizes are
//           priced per size. No second area, so the ES logo sits inside the print.
//   sticker pro_358  Kiss Cut Stickers, from $2.29 (3 x 3 in).
//           One area "default" 900 x 900 @300, placement fullSize. Logo inside the print.
//   mug     pro_4v5OfYhyRx62KW5b7Oj6Uw  White Glossy Mug 11oz, SUBLIMATION, $5.95.
//           One area "default" 2700 x 1050 @300 (9 x 3.5 in): a full wrap
//           (placements front / back exist; FrameUp prints the whole wrap).
//
// MERCH_TEMPLATES="tee=<id>,mug=<id>" pins other ids. If every id stops
// qualifying, the server searches `search` and takes the first blank in
// `category` that qualifies. `snapshot` is used only when Fourthwall can't be
// reached, so the designer can still draw at the right size.
//
// Pricing per blank lives in merch-rules.js (BLANKS[kind].retail / margin).

const TEE_COLORS = [
  ['White', '#ffffff'], ['Black', '#020202'], ['French Navy', '#020718'], ['Red', '#ed0739'], ['Burgundy', '#801f24'],
  ['Heather Grey', '#cfcbc8'], ['Dark Heather Grey', '#2b2928'], ['Stargazer', '#3d737d'], ['Khaki', '#6e6b4d'], ['Desert Dust', '#cab9aa'],
];
const HOODIE_COLORS = [
  ['White', '#fefefe'], ['Black', '#080808'], ['Navy Blazer', '#292d3b'], ['Team Royal', '#2d407d'], ['Team Red', '#ff2d41'],
  ['Maroon', '#7d263a'], ['Forest Green', '#335231'], ['Team Gold', '#ffa912'], ['Carbon Grey', '#c7c3be'], ['Charcoal Heather', '#463e3d'],
];
// The blank's own photo per colour (first of colorVariants[].photos[], public
// GET on 2026-11-26), so the snapshot can still show a real blank to mock up on.
// The live template reply carries up to 4 per colour.
const PHOTOS = {
  tee: {
    "White": "https://imgproxy.fourthwall.dev/JlZRh3G_d1lJumNzXOzkpo2GgDIYeuGxb2UEGgsCSzc/w:720/sm:1/enc/ERAphWI7I36oSWoy/udPg3mNxudmNlzuK/i5PwUYEAHD_8SjLz/jgzD6wg4yoCTY0BR/XSXdVtdzA0I5O_DJ/b75OYDimSstX_kor/o-UWDtIZ1Ut5QHbX/0nld0jyssdSMdrvd/6xUUPKdRiJs8wnxc/XnKweTt5ZQ9AxSYr/SzDpZshOHmpkUBzB/XG-YOW92R78jMqme/9rmCRR2WqVo5VjU1/aDUvgg.jpg",
    "Black": "https://imgproxy.fourthwall.dev/MMkocS1sfnAe7TJiwEvc6svDULAzZSayTmAIqTs94kM/w:720/sm:1/enc/Exv6_LUDaRavTScr/HV1DqT4cczNl4z-h/G12I2AqgrBUz-17I/V7sLI0QIRC7eRtCZ/GlPfetqfo6CF4a6L/wcOEFVFikY4BnvXq/3jt9lAImnWTQYdHz/8xSjI3OJM3n3JZ0N/A6D51P9od3jIpWsc/bz-dTleE3P9UnK96/t6BewbO1C6lqzv7F/ZnbVHrQKIkdVuGHA/9rly4ZjYnUQ9L92o/L4Vq2w.jpg",
    "French Navy": "https://imgproxy.fourthwall.dev/ohX-EfccCc2jqvKFL1Aptt8SLIK7M-PdQ1o6be15Kzo/w:720/sm:1/enc/Y7VUOiCEhepgefWZ/rbToa4TTCtSbocDk/5nwc0RTg1epJhjTC/HI3w15Wcl5G4BGIO/Kn8H0QRYzY9ZmJ9X/2YKWbGFQD3vSheDu/q5IaDjJ6zQqgVAfS/6nYD76ggxV-RlJLE/zTn_WsgCrEU738OY/-REeYUsqS1dzFKof/sW3Ge5AIK0g7XSJe/ofoXuNmoxdt-0us9/WvZ0Oi9Pj5K7yil_/_30CRw.jpg",
    "Red": "https://imgproxy.fourthwall.dev/6CYnUsgTJMxjbFuKypOJC-fbqwyNqWtcTjYMMN0zq8M/w:720/sm:1/enc/iJDk1mowjSLhINna/uGGBlBOkqF8LS96T/fPPWhgP_OXXRveuE/JTMMlecqDqim8SAy/P2JQuXXU0h8nkrlI/kIcO6yA92NiXPheS/VvHcgQrPcmRB5lsj/rJ0g28m6awyhcwvh/kxAy_-phAD9_nNJ1/kuI9YsNtdH7NOYtE/_SuPNain8fgEFz43/gDVmYOgyUVKp0oqO/hqOLHcmhpr9aog62/g5blxw.jpg",
    "Burgundy": "https://imgproxy.fourthwall.dev/narw8cAntyXRbUspudXvYQLRInYXVI2VkssIBlFVIao/w:720/sm:1/enc/XTfG_amzn4dRMf3P/MhEklhNJYzr_9j5m/7gzI1ZL35HFS9Nrd/ekzOmd0QXf3nWXoB/phCkSic8B7RuVJdP/4cVseuWs2UfLZlbG/qewLbYKsDhJhhD_Z/PuNAjcpcYbD8tosn/Zpbo5qsh2JW6Xp0E/ml6vbCokQHFzFz57/eswxj838ukOXOZJS/GiCMKIn8UbQG7cOw/UEAoP17frTTPYWyp/FYfuDw.jpg",
    "Heather Grey": "https://imgproxy.fourthwall.dev/0-9FmA0gFVYWrWYTkIKE56mg3uQWu24hp3XcP7ejdqo/w:720/sm:1/enc/pGFUFHlOM34bdj9t/eYX7CGQbcqGQnuH7/LHhkLzUAOC8qXYUn/KtVwiVpRvL3PvDLF/fJCXYZ_CVg_SsOvx/EZUovwVLnbm9g-m9/1Op03cEPl6EUrgVK/Nt2pctFTMz_2X8NM/pM3z3VjE75GCvZf6/oLHwx-6oE7rtN-ZE/DqwPPRfrNFbjAi47/xmgg2v24LrbwxrpG/1NgswBbBva4LB6wW/w17aow.jpg",
    "Dark Heather Grey": "https://imgproxy.fourthwall.dev/siKavQ_RtqRA3zwUJmKDP38Q9TaDr2xLGeRfvXh5WKI/w:720/sm:1/enc/JVN_5LFDumtg6587/4h5FcrJsSNijJL5o/jp4uGOovNNwzyoxF/peZm9RNgz_0Eieli/oQd-FEivR3lsU4vi/KPo0i__1JmIKqbfS/FitiG1HObZI0MhEX/b8CceIxIEyR-ojxZ/0LB2GCoPeuU3HwXs/jG9TY9sm265EBPDY/31mmKZg0LfX1fUoY/GKKeV9StgeV2Iksg/B87pr58R_h2FRxGI/_UGCvw.jpg",
    "Stargazer": "https://imgproxy.fourthwall.dev/YzDbuqNWQLFbFqP4RHgg8VIvh-5o2akCHOshcHDypVs/w:720/sm:1/enc/qFW1i0FwWmxfjIZx/wtixgwZ30EGmR9oa/XESo333dFmx4VGDl/yjy61o6vMM_NRbYC/fiJQyRCVBRfVMnmL/0VZsHHA1cdgf-bky/90aEcFBP9eF8PtUw/UsiCw7LxVBTcXpka/oZaY0u7wBtVBazjH/bZQY30r0c5rZOBbd/1NFoZMPa8fZ2gq-K/kyds_peR4snFCs8Y/LYEDAKzQ7FfEQTpi/z-DGKw.jpg",
    "Khaki": "https://imgproxy.fourthwall.dev/kOI4EDbV-e1YtoazGTfLM3iPod_NBJ34tUWrqg-91Rc/w:720/sm:1/enc/7vL5cuteUid8Iv72/HwLvRKL-WvnXUL2d/xO3HeE2adutGsNtt/6kyGDVuHylldZeCH/C3nHRV6ScSaD2J-v/idqvmOfWBAq5ckd7/cxGgFCwzrWAkz7Pf/kC8AcQ7skFIRqdJA/Hl_nveKds5MGSoYQ/tfS29n-scUP4AYh5/dZmo_pIDEkVOFRUT/57gcumgC93NfLLN4/MHNqnNYBZePj2nyp/y_OBqg.jpg",
    "Desert Dust": "https://imgproxy.fourthwall.dev/OkADj88yzQZjciVfVK49FdDhT9hlkV1ousl8lWRKZEE/w:720/sm:1/enc/vWmySApH_axbjzwk/IOhHmoUXB1qqlYSQ/i-rcurnDpBv-C7Xp/wgT8G2yFcqO_nhdJ/1d5xZSbfQXcGjUvj/rWBdG9ePRZe7_dTb/Wkl1O1AtMKcT_9I7/RbbIQZ1Or83Wg7It/gsREOX1QoEMncjGR/M6kbzMiAdHH9zmxs/oqmYw_z8ckvUYIdE/Qc0QcH5Q0qJvS7nJ/bwVknSuCPPXmtUkx/KZj9mA.jpg",
  },
  hoodie: {
    "White": "https://imgproxy.fourthwall.dev/sdpZv6JwVn8EekecKGTP9DvfRlbjrOAtg5PKEesdICU/w:720/sm:1/enc/L0JwSpVzJEygAOgu/Vk_cC6bfbQ1qvTHz/WqqBRgPOHnFXMgrH/1gU332eI7BgG2hVw/Mlo0gxfzn89i4BXF/B_rXHTnLbe1TO6wZ/yg2iUHLnTvbRNj1s/VWXq_2Hk8zatqpTq/DlPdaSTF-no-pRGi/BLxcuz-UMzsos7Xd/ecL19DY44AQc_DMB/nLvzI4BafrQi46dt.jpg",
    "Black": "https://imgproxy.fourthwall.dev/2TJ9mT6D5K4Mv-GGcXoDEXjPN0vQNdJc1TU_wtyXwl0/w:720/sm:1/enc/crXltowfa4aX2mhk/HSVRi8HZbhHBt9Ji/cWWL7HYTdwv6j0vH/LJbrm4WRw53ThOIg/AfCv28qatNNsez0q/3qWUgktA_rg3QxaF/LhZCgsIqy8QRaah4/IM1-q8sTsPdU99P8/jrL1Gdq_XTj0f1Ju/Xn7_ACgOCC_xdQB3/ddlcJGJAsVAyuv9U/pXq7CDWKKMEjVsKQ.jpg",
    "Navy Blazer": "https://imgproxy.fourthwall.dev/BUvCZpmfSXc5l8p_ylzfuP1l0zQu57gWnEv7hddivhs/w:720/sm:1/enc/vn-U1yT7T9vG0p1W/0iW06zD2F7wV3w9g/h95-zCG6mtKtezSx/lrhHitkG6FE7Juv_/kf_S1_kRjTGRAQnT/fHIB375GYNanlKlb/CFi3tJXvj41C-B_4/Z7qTtot8xnja4LHO/yPErXHOuMDMOxqYp/aYwzc-IFv-cVNKTX/ee1riQjJOkvG5r4N/WuHt3QoxP94Expj3.jpg",
    "Team Royal": "https://imgproxy.fourthwall.dev/dnjB-tr7I8rUfmgz8Q-tPB_00HJKg7KV24B1n_ngMVU/w:720/sm:1/enc/NsD47DdPnzHKT72N/qbYt2Z2dSYemJPKM/9o_vLG7uCklpvepN/IwkFll1b0hV_uUwS/xW7GC4KJF2wynLY3/Ok42fUnYfrPuFbve/xWWZMtBdbtzL0gws/Xj777chry7kK_vmx/MdRUCjOG0T5sp2Z5/-3Sn2EiTd5lgx8kW/i9177ENnzdMoZsdT/GHIFaYWvMe29u7K1.jpg",
    "Team Red": "https://imgproxy.fourthwall.dev/KhTbS8MNUlq9fq7CKE_rbVjdB86Sbczbnr7dgJI5m9s/w:720/sm:1/enc/ZEkVJGJFf7CO6QgT/CMLfb6TnYfa0Hrvi/WhUWsc_z5rtiWbLP/bnO0jl2CYyolBnpJ/bxXBs3XtHJzLkkl8/F17aHCYPUuXBdSkS/Edg5svQWFLu6VwxM/05x02dfVwdirKKtD/LCHrIQg4YzgqrAol/Zw94G20hDarrrmWd/jWH524iTRv5piOJz/T0V1t94SBTNZTDvF.jpg",
    "Maroon": "https://imgproxy.fourthwall.dev/yarqenAWW9-2sIohQUzXOgcWVr6OU8eE-DUa5Dy8epg/w:720/sm:1/enc/hIuuhz1l2bT_Y2Xv/2eRIxz_Lvr7vP76k/qwyISmQ2aHP0N-kT/OvWc8tiN40TmZiMz/Y1t_9wnvkOey0KH1/mCcDVODSzrA15ooH/FzHzkIjIMOxeVxs_/to-x_KcwkfxYvU02/BSorGGhROKGUJ_yp/ugG6GVl78DYKkn6V/BYwoapAukFKTo2rA/_BZNKGPrOKGwGwY8.jpg",
    "Forest Green": "https://imgproxy.fourthwall.dev/mmJJbjLSmSLhXQ-NN6tRG1AimYRnDN_4VV60goWqC84/w:720/sm:1/enc/iDRW4PPaBVE9A0kp/uIxpT41djlynrGH4/4JeESVuDmu-XbRSV/FJvf4zhc_rwe9W19/5Uf_uGC36M_Dxzq8/0c3c3YjG4G4jzGsb/bWRETevp6rd-lyrU/FgOYnpi3OMeWApqO/o9p5AUOt6askKeSl/XR4lZP5DSBA_a8AW/jbZpyxXGnfKI5hbJ/rq2f12tzxAi2Sywq.jpg",
    "Team Gold": "https://imgproxy.fourthwall.dev/uTghxWU6dL_C6DZsX9MYcEWwPmd49m62oCo4L1QKGVA/w:720/sm:1/enc/eBin1qLjp2NKsYcR/g0_L320icVyF2SGW/IaWfpJBfc3OHI3tU/Nkr0alGYO-InZUqN/frvcwODb4qe5XAQq/Kk6hQ13j-QirgY1-/VFUL6v67MI1GRAxd/MdZqjOQMztMX8oM0/hOanK4wjuJRI7AWv/nPhPndCgljxllgcA/OCmd-qZSC-N2Yihl/WWZ8wHzrwADR9747.jpg",
    "Carbon Grey": "https://imgproxy.fourthwall.dev/G3DBztAsHnTB_F2oBSjLtp62y0TZBjDJxDU1mVdFVbg/w:720/sm:1/enc/51ulX3000kA5UoJQ/ZD2Ta0SOKUj2gcjA/BFXMwyvhHC1l7SLv/y1hEcQCk6qZL42e5/GhMopHpA28qlMFjY/d0LfGHgcOwe9Egyo/BSYZq815L-5GPJri/L9x7IWaiSlgcTu6d/Pl3h_PSyAi8ore9l/iZ2b9NdW47ort3xZ/SfEry4fnCxCAf8ie/WvEk9lEvq6t-SQCO.jpg",
    "Charcoal Heather": "https://imgproxy.fourthwall.dev/51xbC370QJBgFJYDYZW-UUvHHXkrVP9rzFKTrJAYeSs/w:720/sm:1/enc/R9gHy7ghO2lVeGiZ/idl_LTmq213jDK_N/T8jk8kZLYoPm3Fi7/wQGpEqekUHd1L_Mc/8sdcoa2Rqtn5PBeW/8HRV8HldqmKnBPEe/l-7NRC4Xud-LvOys/4AXGbN6sUjJeTSZM/EcslsWmjH7GRB_8z/I4TkbMiKdtdOJ-B7/RELweS2yJwbuBaMp/G-1MQtJg05b2E1Su.jpg",
  },
  poster: {
    "White": "https://imgproxy.fourthwall.dev/TQRb03NYJ0JROq_tdK3vzq_ek0SFQ6mX6NfzroNH7Fc/w:720/sm:1/enc/nFBk6K3RRUZiasrV/4XAfpnhMz8Ft2dwW/S754-nHJP1z6FUh5/WGHUgzKYyxdFSWWH/xyv3m1h9OJfh2oGw/b313eSoJJQbl27hy/TabBXJQjG09uU2cM/dkfari19m3Z0I3PX/aQUZNAz0S8TQSNYF/sO2f7r8hU8n35dnZ/oudV0QUi0xe0-zul/z9IiNRPZsg1c5lnM/Mmz_sVsqcb4J3HB_/hFVB2w.jpg",
  },
  sticker: {
    "White": "https://imgproxy.fourthwall.dev/47Gl5hSeftBDl1af_sPL9QRsPB3YLmfcsY5hZYxiVgI/w:720/sm:1/enc/xSjIZrBMswoC5eyu/tP7jJ_gPEIF2hbQ9/wi7EenAjnpT5Cwms/q6FCbmnZY_JWDri4/uNW03DK9cb_BBEfl/Njv_HI8RZFutjz-W/T_53l8sxTBHYQGIC/OaykxrVL149HOyQT/JcGMXor9P4MLgyLq/8IDWqIJskVmlR8ee/e8deI8mrjS38gPcj/cF3WapjEExiVyvWB.jpg",
  },
  mug: {
    "White": "https://imgproxy.fourthwall.dev/JwU34XF1lPQZuJZjUj601DZX_xVfaywWtMlhYTIKeso/w:720/sm:1/enc/pEmmIFPHt0Qax8FA/ZJiaDaywdFeAj7yI/PNsFD5evNZ-_3UV6/kw0J-VHffeC6W-mb/zZc-DisZNvb_S9Ui/NfM_kg8sF8OsaERH/eYuywOKKVv_-HXLy/nDBh4Kzzs1QYPqfA/c-SVtZIvUa3WYgc-/JCztbKbZS6-WFCPt/J4nLL_u8axAfrcQZ/WZzCZofdc845vy7k/seFXyK7JqmhlmuPY/UcWsBQ.jpg",
  },
};
const colors = (list, kind) => list.map(([name, hex]) => ({ name, hex, photos: PHOTOS[kind]?.[name] ? [PHOTOS[kind][name]] : [] }));
const area = (regionId, w, h, dpi, inW, inH, { name, logo = false, design = true, renderable = true, available = true, method = 'DTG' } = {}) => ({
  regionId, name: name || regionId, type: regionId, available, renderable, productionMethod: method,
  pixelsWidth: w, pixelsHeight: h, dpi, inchesWidth: inW, inchesHeight: inH, suitsLogo: logo, suitsDesign: design,
});

const BLANKS = Object.freeze({
  tee: {
    label: 'T-shirt',
    ids: ['pro_Vv1XdaPMSdm6jZ5pj24NCQ', 'pro_e4677535402b4eeb81', 'pro_EJBSRKhJSd2unv4ZnGKwdQ'],
    search: 't-shirt',
    category: 'Apparel/T-Shirts',
    regionPrefer: ['front_large', 'front'],
    placementPrefer: ['largeCenter'], // verified on a real shop: PLACEMENT_ID + largeCenter
    placementStrategy: 'FULL_REGION',
    apparel: true, minDpi: 150, wrap: false,
    logo: 'area', // the ES logo goes in its own small area (sleeves)
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', name: 'Stanley/Stella Unisex Organic Ribbed Neck T-Shirt', brand: 'Stanley/Stella',
      productionMethod: 'DTG', basePrice: 15.85, currency: 'USD',
      regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18,
      placementId: 'largeCenter',
      areas: [
        area('front_large', 2250, 2700, 150, 15, 18, { name: 'Front Large' }),
        area('back_large', 2250, 2700, 150, 15, 18, { name: 'Back Large' }),
        area('sleeve_left', 600, 525, 150, 4, 3.5, { name: 'Left Sleeve', logo: true, design: false }),
        area('sleeve_right', 600, 525, 150, 4, 3.5, { name: 'Right Sleeve', logo: true, design: false }),
        area('label_inside', 450, 450, 150, 3, 3, { name: 'Inside Label', design: false, renderable: false }),
      ],
      colors: colors(TEE_COLORS, 'tee'),
      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    },
  },
  hoodie: {
    label: 'Hoodie',
    ids: ['pro_380'],
    search: 'hoodie',
    category: 'Apparel/Hoodies',
    regionPrefer: ['front', 'front_large'],
    placementPrefer: ['largeCenter'],
    placementStrategy: 'FULL_REGION',
    apparel: true, minDpi: 150, wrap: false,
    logo: 'area',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_380', name: 'Cotton Heritage Unisex Premium Hoodie', brand: 'Cotton Heritage',
      productionMethod: 'DTG', basePrice: 27.29, currency: 'USD',
      regionId: 'front', pixelsWidth: 1650, pixelsHeight: 1650, dpi: 150, inchesWidth: 11, inchesHeight: 11,
      placementId: 'largeCenter',
      areas: [
        area('front', 1650, 1650, 150, 11, 11, { name: 'Front' }),
        area('back_large', 2250, 2700, 150, 15, 18, { name: 'Back Large' }),
        area('sleeve_left', 450, 1800, 150, 3, 12, { name: 'Left Sleeve', logo: true, design: false }),
        area('sleeve_right', 450, 1800, 150, 3, 12, { name: 'Right Sleeve', logo: true, design: false }),
        area('label_inside', 450, 450, 150, 3, 3, { name: 'Inside Label', design: false, renderable: false }),
      ],
      colors: colors(HOODIE_COLORS, 'hoodie'),
      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    },
  },
  poster: {
    label: 'Poster',
    ids: ['pro_15bc29bc8a324d449d'],
    search: 'poster',
    category: 'Home & Living/Wall Art',
    regionPrefer: ['default'],
    placementPrefer: [],
    placementStrategy: 'FULL_REGION',
    apparel: false, minDpi: 300, wrap: false,
    logo: 'inside', // one area only: the ES logo is drawn inside the print
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_15bc29bc8a324d449d', name: 'Enhanced Matte Paper Poster', brand: 'Allcolor',
      productionMethod: 'PRINTED', basePrice: 5.5, currency: 'USD',
      regionId: 'default', pixelsWidth: 1500, pixelsHeight: 2100, dpi: 300, inchesWidth: 5, inchesHeight: 7,
      areas: [area('default', 1500, 2100, 300, 5, 7, { name: 'Print', method: 'PRINTED' })],
      colors: colors([['White', '#ffffff']], 'poster'),
      sizes: ['5" x 7"', '8" x 10"', '11" x 14"', '12" x 18"', '16" x 20"', '18" x 24"', '24" x 36"'],
    },
  },
  sticker: {
    label: 'Sticker',
    ids: ['pro_358'],
    search: 'sticker',
    category: 'Accessories/Stickers',
    regionPrefer: ['default'],
    placementPrefer: ['fullSize'],
    placementStrategy: 'FULL_REGION',
    apparel: false, minDpi: 300, wrap: false,
    logo: 'inside',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_358', name: 'Kiss Cut Stickers', brand: 'Allcolor',
      productionMethod: 'STICKER', basePrice: 2.29, currency: 'USD',
      regionId: 'default', pixelsWidth: 900, pixelsHeight: 900, dpi: 300, inchesWidth: 3, inchesHeight: 3,
      placementId: 'fullSize',
      areas: [area('default', 900, 900, 300, 3, 3, { name: 'Sticker', method: 'STICKER' })],
      colors: colors([['White', '#ffffff']], 'sticker'),
      sizes: ['3" x 3"', '4" x 4"', '5.5" x 5.5"', '15" x 3.75"'],
    },
  },
  mug: {
    label: 'Mug',
    ids: ['pro_4v5OfYhyRx62KW5b7Oj6Uw'],
    search: 'mug',
    category: 'Drinkware/Coffee Mugs',
    regionPrefer: ['default'],
    placementPrefer: [], // the print is the whole wrap
    placementStrategy: 'FULL_REGION',
    apparel: false, minDpi: 300, wrap: true,
    logo: 'inside',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_4v5OfYhyRx62KW5b7Oj6Uw', name: 'White Glossy Mug', brand: 'Mugz',
      productionMethod: 'SUBLIMATION', basePrice: 5.95, currency: 'USD',
      regionId: 'default', pixelsWidth: 2700, pixelsHeight: 1050, dpi: 300, inchesWidth: 9, inchesHeight: 3.5,
      areas: [area('default', 2700, 1050, 300, 9, 3.5, { name: 'Wrap', method: 'SUBLIMATION' })],
      colors: colors([['White', '#ffffff']], 'mug'),
      sizes: ['11oz', '15oz', '20 oz'],
    },
  },
});

module.exports = { BLANKS, BLANK_IDS: Object.keys(BLANKS), PHOTOS };
