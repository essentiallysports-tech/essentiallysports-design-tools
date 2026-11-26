/* Merch Designs sample data (local preview and tests only). merch.js uses it
   on localhost, or with ?demo=merch off production, instead of /api/merch;
   ?demo=off turns it off. Everything here is made up and labelled "Sample
   data". scripts/check-merch-ui.mjs serves the same replies as a mocked
   /api/merch, so the shapes follow feature/merch-server (netlify/functions/merch.js). */
(function (root) {
  'use strict';
  const MOCK = 'how-step-review.webp';
  const area = (regionId, name, w, h, design, logo, dpi = 150) => ({ regionId, name, pixelsWidth: w, pixelsHeight: h, dpi, renderable: true, available: true, suitsDesign: design, suitsLogo: logo });
  const spec = (id, regionId, w, h, dpi) => ({ templateId: id, region: 'front', regionId, pixelsWidth: w, pixelsHeight: h, dpi, placementStrategy: 'CENTER', garmentColor: '#FFFFFF' });
  const WHITE = [{ name: 'White', hex: '#FFFFFF' }];
  // Merch7: Fourthwall's real blanks and photos (public template GETs, 2026-11-26,
  // via feature/merch7-products _merch-templates.js): every colour carries
  // photos [{ url, angle, index }] in Fourthwall's order. The tee's White
  // colour keeps plain string photos (older servers) to cover both shapes.
  const FW_BLANKS = {"tee":{"templateId":"pro_Vv1XdaPMSdm6jZ5pj24NCQ","name":"Stanley/Stella Unisex Organic Ribbed Neck T-Shirt","label":"T-shirt","basePrice":15.85,"defaultColor":"White","logo":"area","apparel":true,"sizes":["S","M","L","XL","2XL","3XL","4XL","5XL"],"regionId":"front_large","w":2250,"h":2700,"areas":[{"regionId":"front_large","name":"Front Large","pixelsWidth":2250,"pixelsHeight":2700,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"back_large","name":"Back Large","pixelsWidth":2250,"pixelsHeight":2700,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"sleeve_left","name":"Left Sleeve","pixelsWidth":600,"pixelsHeight":525,"dpi":150,"renderable":true,"available":true,"suitsDesign":false,"suitsLogo":true},{"regionId":"sleeve_right","name":"Right Sleeve","pixelsWidth":600,"pixelsHeight":525,"dpi":150,"renderable":true,"available":true,"suitsDesign":false,"suitsLogo":true},{"regionId":"label_inside","name":"Inside Label","pixelsWidth":450,"pixelsHeight":450,"dpi":150,"renderable":false,"available":true,"suitsDesign":false,"suitsLogo":false}],"colors":[{"name":"White","hex":"#FFFFFF","photos":[{"url":"https://imgproxy.fourthwall.dev/JlZRh3G_d1lJumNzXOzkpo2GgDIYeuGxb2UEGgsCSzc/w:720/sm:1/enc/ERAphWI7I36oSWoy/udPg3mNxudmNlzuK/i5PwUYEAHD_8SjLz/jgzD6wg4yoCTY0BR/XSXdVtdzA0I5O_DJ/b75OYDimSstX_kor/o-UWDtIZ1Ut5QHbX/0nld0jyssdSMdrvd/6xUUPKdRiJs8wnxc/XnKweTt5ZQ9AxSYr/SzDpZshOHmpkUBzB/XG-YOW92R78jMqme/9rmCRR2WqVo5VjU1/aDUvgg.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/St867f917cFyYX2tf8OmVo4iNfmGslbOiWx6GyyTnsQ/w:720/sm:1/enc/JmfwTDthWkJZfanK/NG9cZnG8CdLHkFVe/cVDHIzYOTgihQRnL/be3fLBu9d1tIpXR_/-j7qSbfarFIOCiVk/-7e5RzFL0dZ58LZa/1FVMFomDcarS9w3Z/2J5jtkw0rcDsMfXw/shp3589rvtKLq7lS/BaKGX_bBUPTzemJh/Y_Hjc7Aq1XabSKcl/774gB_Q5d60WrRrV/dwmTe1m5FkXDWKaP/6fQpMg.jpg","angle":"side","index":1},{"url":"https://imgproxy.fourthwall.dev/whg8tcyVBX1ftsMu5UrfJ46roOOZVgyOJxGa-0H-7-8/w:720/sm:1/enc/S-ZmpunbgJ7JVM04/vnWymDYdwxQoCSiJ/YYHZ-9gsN4Kj6-qL/XJnu-6jmJHFAuy8f/sU4YUKLAgUrYzjmt/uNKpBae0scg8F3xs/y_TB5Ij31HET27sL/VwCOMrhnuJtSEbNS/BVD8MLTaneg7W0Pf/OKE8iqEq4bwTKXvg/okGROZC3gNodPDfz/4W53vMaRLXSPca_d/kv-quvzRZT5tuQ37/VE8W0Q.jpg","angle":"side","index":2},{"url":"https://imgproxy.fourthwall.dev/Qq-GP7x4QxpvtjGrJsEO1bEX9O7vp6ltSFMODvGYd2o/w:720/sm:1/enc/Ks1z1j6C3fdTIZA1/7VocxhmMBoXIJi-Z/Rz_aL3vftOoCPgQL/0q5TVo47eqaNiH2o/wYZ2Uy27r4ocnHgl/hzl8PILJXMd8_fzM/vrySTYvNI7WIcJ9h/lQTOZkF5Ve6ntPuY/74C1mbjL2D0wcING/LroFP69uacBKCwaA/eT88jY1NVpgvPz7k/sK7kb7CrGXhG8SGY/A2w45vVhFc7ZGo2N/RTX3eg.jpg","angle":"back","index":3}]},{"name":"Black","hex":"#020202","photos":[{"url":"https://imgproxy.fourthwall.dev/MMkocS1sfnAe7TJiwEvc6svDULAzZSayTmAIqTs94kM/w:720/sm:1/enc/Exv6_LUDaRavTScr/HV1DqT4cczNl4z-h/G12I2AqgrBUz-17I/V7sLI0QIRC7eRtCZ/GlPfetqfo6CF4a6L/wcOEFVFikY4BnvXq/3jt9lAImnWTQYdHz/8xSjI3OJM3n3JZ0N/A6D51P9od3jIpWsc/bz-dTleE3P9UnK96/t6BewbO1C6lqzv7F/ZnbVHrQKIkdVuGHA/9rly4ZjYnUQ9L92o/L4Vq2w.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/dWVBwl7ed41fnaldubACYjJXobA9oK8R0j9HgpX8fXg/w:720/sm:1/enc/VFt94B-j9N8ml1Ad/48DnSD83o2ExJPt2/-Pu43YfRLash5cxi/FiS8vIj1xuIsZg8r/6OXvXCi1SzSI6o2Q/H8-b-6a6U-R3oIpd/W4jGSMpRv3yPf0ry/k47X8oTWrFioyoHp/2IMyADbrmtu0QXxk/eUrTdv-5mTOWwiSr/Oexn0zpukEWok1mh/wOgZhqpdH8HteDi-/8eMbDrxV4pkwfdAq/BxrVog.jpg","angle":"side","index":1},{"url":"https://imgproxy.fourthwall.dev/KnpPPSrusTsdZY25pBvfVm79YS8tXPQR3HcJ3lbraxc/w:720/sm:1/enc/3a_I7Y51Ff_5bd0K/bD6I8e_rlsBnrcJp/uyEap8H9nvz_so1A/zkkYpTNDoe6OMgpd/q4iIBAaxi5P_FSLy/LycJVQDr3oanZb1i/qB9KcK3sK5Ox8I8w/58QgMKcUO55WGqQF/QGwNxLVLkn7HqRI2/t5F-zmY4O_2JUPvq/PYf7KGAo7D_MjUpQ/CNHLEZBltLTodMmJ/xy_dE5bDYaAS6ta3/p-L5HA.jpg","angle":"side","index":2},{"url":"https://imgproxy.fourthwall.dev/ColeytEpQgitKvi80Bo2ikBSACsqcGTBnV5eFMKgOpc/w:720/sm:1/enc/YXNS4bIDLVMRDGlH/obLMPRvlcJNUt8Ps/hyyk7lHTGHHXpd7T/rL5vVC9pWkcYTCyu/oGaLV8jsTlU_M24S/ep4Jr6XjX6kQdEwr/DtO6qBo0GAD_xtYo/fojeSbQ265dTFIAD/t3_GLVwdkdkSbWe7/VzKAyx7wVgM0o3ox/9V_JgWPAxRQlmFMi/HsN_tDplVp9ylznO/nbqTJgpaPlD07nqA/erQxvQ.jpg","angle":"back","index":3}]},{"name":"French Navy","hex":"#020718","photos":[{"url":"https://imgproxy.fourthwall.dev/ohX-EfccCc2jqvKFL1Aptt8SLIK7M-PdQ1o6be15Kzo/w:720/sm:1/enc/Y7VUOiCEhepgefWZ/rbToa4TTCtSbocDk/5nwc0RTg1epJhjTC/HI3w15Wcl5G4BGIO/Kn8H0QRYzY9ZmJ9X/2YKWbGFQD3vSheDu/q5IaDjJ6zQqgVAfS/6nYD76ggxV-RlJLE/zTn_WsgCrEU738OY/-REeYUsqS1dzFKof/sW3Ge5AIK0g7XSJe/ofoXuNmoxdt-0us9/WvZ0Oi9Pj5K7yil_/_30CRw.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/2ItPaupGtISCnpVgRHSUciMZbqAKuxfP_YtHskHihYo/w:720/sm:1/enc/VIUCnG752qFDLKQr/InIgsgLtFzXRau2O/u95OCxNRDPrzIt8z/nuIMLWB0w7qvagYv/wMV97Xf9VqYQBe9m/ww46e61jKfo-4Lsz/YwymWR08r3r65uFs/AfqrEpu0jP96qKVw/zjCOzq1PA5MvtWPa/I1awCFWCHAEMCkwR/_BEZvyldv8vsosxR/sms08Xe9duzKVChH/K1anPEmMhn8zR0zS/Bxzanw.jpg","angle":"side","index":1},{"url":"https://imgproxy.fourthwall.dev/cuIN36CJA23LqMwlB8PCR6IB8x14wAmAzUmcbkoebBo/w:720/sm:1/enc/jGLisYM90k-FnafS/98xlRn_Z6l3y4Y-o/syOqw5gHS8zXsauj/a-7vdnZ2Chln6ZUn/VfXfP8d_L26XLai0/hAtQW8I0nUllT7Em/iOeQ8Xj9kbp80Kpv/J5oNYpeRsbxw7k8p/zDUV90NCBXHIwvua/LD4PBfPB9geeFbMK/bmTpmOr2aaGxSfjN/XzbKBJZkA8wKzLhR/YXxUrvSUyTteAyYD/HXn3ZA.jpg","angle":"side","index":2},{"url":"https://imgproxy.fourthwall.dev/GuIdPMKH0iQ7g3TFHVmlHwNmeKxQEjnI4Qaet_pAP1Y/w:720/sm:1/enc/xb44BwjfVcE09GM9/yt6loqliSFZIRU2b/Bji15wwE-2Uu55YV/7zhooEbxmhiBoIkD/cr3xaHNmSQrBJd5i/GwYphfViWrz8M3NB/edOsZ9Jheo_1iprD/4h4n127okQDg-Cf9/CykoQCNKWXB2lQEy/3wmt49w67ORB62lc/HF5LY_v2IPreJNyz/Rx7WKKfrmZUBox2L/m5jCrY9FfiDOACmJ/xc8MaA.jpg","angle":"back","index":3}]},{"name":"Red","hex":"#ED0739","photos":[{"url":"https://imgproxy.fourthwall.dev/6CYnUsgTJMxjbFuKypOJC-fbqwyNqWtcTjYMMN0zq8M/w:720/sm:1/enc/iJDk1mowjSLhINna/uGGBlBOkqF8LS96T/fPPWhgP_OXXRveuE/JTMMlecqDqim8SAy/P2JQuXXU0h8nkrlI/kIcO6yA92NiXPheS/VvHcgQrPcmRB5lsj/rJ0g28m6awyhcwvh/kxAy_-phAD9_nNJ1/kuI9YsNtdH7NOYtE/_SuPNain8fgEFz43/gDVmYOgyUVKp0oqO/hqOLHcmhpr9aog62/g5blxw.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/dshZrqh13cvXhKIyCYzj7wmbm52LkVkFSDt-MhPP2aQ/w:720/sm:1/enc/fb0SdjGxYHPnjCJh/pi8bLaKNJkCBxQ51/1MAd32HiF0dXjzPW/3UJhoxlSdPJQEaJu/k1sITCx70toGNSzg/6RAP-UTZKZpsyD2G/pyzIVoC3liYLjKxi/QpOAh51tQAzjuk72/B3b9kRlmc1qn2mQL/O2FtypFFSaQ1RD6l/JgGr3C21GuWp2UQ8/Xrxh2glHAOzXmfMR/J87NmX-wsdROviUZ/rnAvBA.jpg","angle":"side","index":1},{"url":"https://imgproxy.fourthwall.dev/G4ileouW9l2nY5oMLC9Dw3-ZbGXLxsG_Pvgpi5-l_hY/w:720/sm:1/enc/HivoobJMqQghob1M/Oex1IE_-KFDSWe3Y/7q_lZNhyBGOkRDBY/hoxcQExv9dH62ZNd/AbCo5SCARHgDy90f/E_OvpigLXw_0Ii-b/9f6rT3-LBeDVIxGm/Zc66FNJyZD0pkJGx/dRrmmcfc4vBqtIym/FpYcsMt44fbjNggN/UTaqhV-dDde6PcaG/tuA1IMI1wFL1igPL/3NYLAKQJ-UuCyKPb/4Q812Q.jpg","angle":"side","index":2},{"url":"https://imgproxy.fourthwall.dev/5qft5UjR8O9shdJ5sxfdmIbtTs5XYrFdOwy0IYS5R-c/w:720/sm:1/enc/mmWU6jtqsuyl3Ks5/nHRwDi1x5uxPj5lm/_l7-oisIJuy1Fbw0/-5Avw00T2gaW3Mmn/Utq4BjKZWJ4dTXRh/lvfnbELvopAZgZK1/M6PqSbDat0E4RQed/zWrBvoKZpmONl4ME/ZXrXpSjRvqfmFeCN/UbXk9vezmCTu4vTE/5oIxh1su3KmKxjnp/EKunOuiHaRCHfjWp/TnoHGig2JhDh4ipo/1qK8NQ.jpg","angle":"back","index":3}]},{"name":"Heather Grey","hex":"#CFCBC8","photos":[{"url":"https://imgproxy.fourthwall.dev/0-9FmA0gFVYWrWYTkIKE56mg3uQWu24hp3XcP7ejdqo/w:720/sm:1/enc/pGFUFHlOM34bdj9t/eYX7CGQbcqGQnuH7/LHhkLzUAOC8qXYUn/KtVwiVpRvL3PvDLF/fJCXYZ_CVg_SsOvx/EZUovwVLnbm9g-m9/1Op03cEPl6EUrgVK/Nt2pctFTMz_2X8NM/pM3z3VjE75GCvZf6/oLHwx-6oE7rtN-ZE/DqwPPRfrNFbjAi47/xmgg2v24LrbwxrpG/1NgswBbBva4LB6wW/w17aow.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/6Pq9kOrPuWowVg7p84BHfQSqAGbjBKCemJLrmA2MAGU/w:720/sm:1/enc/6l9drEVASK-2xj7Q/iN9lOcdqYz3yw-MV/JY60osdqiaAOAnkU/YnBjDkw4L8ra7YAb/7n5nnUXqcthpL_7p/YHOrX1XKIOYpxt8I/w4xegQPMu8-ZmHoC/WugZgQQ0FUR8p-Do/XFBC7J6atRjN7OMG/dWRkfarHFXYa6iUw/lEoJhbSa5bvUu8zb/7rxKbpMM_oWhUxg3/KOHv9Nucy4um_Yxv/FIwvqw.jpg","angle":"side","index":1},{"url":"https://imgproxy.fourthwall.dev/cI4JgpgK9dn9W8YrDP7SsVsM2qmcaK-X17nOnBt4iF8/w:720/sm:1/enc/W3ymIiZUas_YZ2wY/dK5VrOSslquy8aXx/eaSnRS5J07paHOPX/jrvPfYJDjhMKTZYc/ndO43-vP2hJ-CVeG/SzMI2u-9NZc9JpOt/ILr_vcSooJ_U9SdU/cvQBXEduAEAjMmwg/iI-jfTVotyXpoUi2/SJW1yjXFwRaCY3GL/KmR7BTvvS592hahP/O27Qk_JOEWAPV3lJ/Fp9xZkPwNh8vMsJO/ywiUSw.jpg","angle":"side","index":2},{"url":"https://imgproxy.fourthwall.dev/3mSv3agIVZ4QIwna-GdFOgiDUuSTcwSP7FW4d4ZhTKI/w:720/sm:1/enc/4AvEUb2PcNAfBZQp/Wnk7ejJzIDkcS8dP/LV7bSVIDuwywBWwI/kU5KfaDV18azOa3w/wgx4lE2ITJPq5ihU/k9aFTCGYOxwHHJck/OzZs8uUcg6IgFOU_/PJRD9Z84DYCxs4Gj/7x6BwE1Hvw7nq_jN/5rjWmGjs2NuiETPI/1r2m_PQzkUE54S6v/q4Hpiby4iDnXnuHj/h8qL4B0UJXJ_Dep3/fu-6TA.jpg","angle":"back","index":3}]}]},"longsleeve":{"templateId":"pro_6ae602fcb22447bfbc","name":"Gildan Ultra Cotton Long Sleeve T-Shirt","label":"Long sleeve tee","basePrice":14.79,"defaultColor":"White","logo":"area","apparel":true,"sizes":["S","M","L","XL","2XL","3XL","4XL"],"regionId":"front_large","w":2250,"h":2700,"areas":[{"regionId":"front_large","name":"Front Large","pixelsWidth":2250,"pixelsHeight":2700,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"back_large","name":"Back Large","pixelsWidth":2250,"pixelsHeight":2700,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"sleeve_left","name":"Left Sleeve","pixelsWidth":450,"pixelsHeight":1800,"dpi":150,"renderable":true,"available":true,"suitsDesign":false,"suitsLogo":true},{"regionId":"sleeve_right","name":"Right Sleeve","pixelsWidth":450,"pixelsHeight":1800,"dpi":150,"renderable":true,"available":true,"suitsDesign":false,"suitsLogo":true},{"regionId":"label_inside","name":"Inside Label","pixelsWidth":450,"pixelsHeight":450,"dpi":150,"renderable":false,"available":true,"suitsDesign":false,"suitsLogo":false}],"colors":[{"name":"White","hex":"#F1F0F5","photos":[{"url":"https://imgproxy.fourthwall.dev/lLO4haOMilZrFe6Pj6K5nCSOfuBppyyHVPVVUiVhxcM/w:720/sm:1/enc/f2hFaPNa8RU1D3te/wb-U1MdGY7SQwc6c/iC1PW1pHiy77QNu4/XfXtlZNxOTt3xEGJ/IU8MHiA1q3tFsLM0/sYWR5WumraftFnX_/zWCDgk3siiay2W9i/wHfwWr6aHm9et7_l/6fxRo6EGgkKkX3iC/WgdyDaZGzOwVqJBd/KMhM35e3uA6DkcTO/cU9E9fwu9l_ZicIC/es3HtDzNlzGuMRAn/fvXMnA.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/WCeLMVrnBIQn1iz1x2MX9NsccwoDsQhuU3WHWyDJVfc/w:720/sm:1/enc/k4-YqVc7rFW0hDIA/RnZgxCpn-DXQIbuF/M-MU0UijUiNviZHc/UIB4BQN0ZDvZ3VA2/FkFg79zjn8S-YLlw/FBQO-NziQ9FBy-7J/8mnhv3OfnBvouRfS/CpiB7V5gEDaNrmkV/mWuajbMjHdtLgngQ/QkEiaLo0z0p3GVmK/2mskt0ZTp3YrdiAb/SVMpeTD1-NAnkz7V/R35kKcQ3W2wk8seo/XVrPTQ.jpg","angle":"side","index":1},{"url":"https://imgproxy.fourthwall.dev/3gcv5ncseoQOO1rifo6NKwT_hsvncM8Yn0QM64BRtLc/w:720/sm:1/enc/bjRw4nKmZBsMjnpW/BsYNT9zd72h2hom3/hv8e7Uivqhd1oUvm/wfFfDyUSNDFvlFgt/WgEVyUC-OXUPz0uD/2JQ0-sjwGKi3lJ6W/5GVJMjeBR-HtlkCN/0yt97X2w-8zATjmy/E2jbQAl-Oj6GLhiQ/jt8D1jPDUnri9sER/cZ4syPVbxbFqCAke/z495yYAQIs1Xmvh8/639Aa7kZ6xc0oD5n/Zbli2w.jpg","angle":"front","index":2}]},{"name":"Black","hex":"#14191E","photos":[{"url":"https://imgproxy.fourthwall.dev/DYTldawYZQWVjxzwpU6_gidG5oj18_nzbc7DPaUrlmk/w:720/sm:1/enc/3Ter-yO5K27xfn2F/UwnLcwnD6NxOnTMI/Y8dDN8_m1jKgBZKQ/yllyt0LEfd72BWD4/Cpz9lroAuJW2Zj0N/1jF92UAAlHB1LCog/6ytFs2jSA_r6kFxH/7SHdWsksghDW7lhz/PKc0zjU4ZSUFRm0u/iJ6Q0zLyZ2w-PLS1/sUzpW_LsmWxiqBAV/AkAiUqjG5F_kAY6b/Sbs4g2_nnhBE6eza/Ju4BRw.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/RwRluvvDkzH9sRQrx1Via7IKCW9YGzcGfxosqpX2Iic/w:720/sm:1/enc/YMHSBezix0u99WK_/RyZoIuSU5yR5wkr-/6lGZTfZR-QXWKUSv/aHgoGcFA8wVl9125/ROLsOfVeXgDVIaxC/5N-w_zKpMLpAWeZ7/Q1e7fECB9Fs0wltX/xzH2dqrjnPWLSzVE/TJDW3gBJe-DLkX2b/LUUzjdCdh5N2N31v/zXaCWQL-e1WaiVBP/0bHBffBpzOILrJG4/sNaxdOL6da67MzQR/baBuzg.jpg","angle":"side","index":1},{"url":"https://imgproxy.fourthwall.dev/bwH3lq9dE3X85x6MJXSGQ7a92An5bmvY9PEgeJXH3ts/w:720/sm:1/enc/QuSvk0dAwGbE5Gzj/6wyjG0WRzISiJJff/Wg-mmiG5lQCD8tBi/R4snaFyzXOEy9q8a/N81emafFy0ereyJI/mYQmVyo4481LVEPO/ZTgriqCPwqwib9Mp/JqzeFVmD0PZG84uI/XcJidLxJI7xWtK0I/Tc2OhgPBt2TOVBRS/_AR10rzkNhtVJWe7/6sZ9n_wsjVmIREq2/wEvB2xZpNMGXCMZ5/ExIxPA.jpg","angle":"front","index":2}]},{"name":"Navy","hex":"#191C25","photos":[{"url":"https://imgproxy.fourthwall.dev/r3NwaLWRxM01hN6U2GCFiSjPVNnWVof9oAjQc5pv_gU/w:720/sm:1/enc/wNQMtIK7_UB15I7T/LKaUlZEpRpiPkaZQ/NIwdomDDUO4-LVtQ/ng7-Yof-BSC2rNR_/xw4CF3Sp3nRjwORE/8XDoiRUDzZ5xDYz0/dNJmXc62dlme07Xg/8bafIbUwS6LAfXYS/eSm4pPurNgMtBhTu/f8m82gl8z1AK8mAC/cyNfXV8Lw4G78kYO/w567M2h-66Ow4_Me/hG9UEYwtUO9dgEZE/bU2NHw.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/64eEyEX7VaIfxvlnuw4LhJOapezqPJ6JKIhzanviki4/w:720/sm:1/enc/Nv0ZfZhS-jpKFyNC/X5LREWkSBJgTFkip/GMtuRleiaRIHPqDa/OJbJT06MUmoIEON9/n4CBmkj7kG910XbO/IfOITU4KfLlPHmCi/j9W-V_z5fQqUv7dn/-QDjjVrRNa-UMpQN/NQVygzQXLPUurEMX/D0XDlrDoO-9S1u2j/iHLBwjyAgd-mmeAc/moxsOenDeW4eOLxC/CGlSrgiyp7XyLvcp/XXLhGA.jpg","angle":"side","index":1},{"url":"https://imgproxy.fourthwall.dev/zKt_OtVMuoIWqTVZL1PxpjfPmlo8JVjlikCdSp0yCsc/w:720/sm:1/enc/ej2Jx5PBGgUO9zp0/c6LX1MZGLBXaOal_/NiKp3T5ANPjHc7EP/iVg01xEQQ646j8Mr/WldMdugBUDLxEvHl/lq0-T0IIQpe8AT4X/MrSadHjOV-sDxHIQ/3U41b1ESAzUkgx4T/8tmbetNIL3QjAyYc/masIunaTcYls3w8s/5lvCKVtFDFpvfZDs/eTRavrbhJ0hO74XM/ANMFE3dB8aIW-9lu/SQGtcQ.jpg","angle":"front","index":2}]}]},"crewneck":{"templateId":"pro_14kNy0EJQkqopY-Z9Pm41A","name":"Gildan Classic Crewneck Sweatshirt","label":"Crewneck sweatshirt","basePrice":18.79,"defaultColor":"White","logo":"area","apparel":true,"sizes":["S","M","L","XL","2XL","3XL","4XL","5XL"],"regionId":"front_large","w":2250,"h":2700,"areas":[{"regionId":"front_large","name":"Front Large","pixelsWidth":2250,"pixelsHeight":2700,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"back_large","name":"Back Large","pixelsWidth":2250,"pixelsHeight":2700,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"sleeve_left","name":"Left Sleeve","pixelsWidth":450,"pixelsHeight":1800,"dpi":150,"renderable":true,"available":true,"suitsDesign":false,"suitsLogo":true},{"regionId":"sleeve_right","name":"Right Sleeve","pixelsWidth":450,"pixelsHeight":1800,"dpi":150,"renderable":true,"available":true,"suitsDesign":false,"suitsLogo":true}],"colors":[{"name":"White","hex":"#FFFFFF","photos":[{"url":"https://imgproxy.fourthwall.dev/s5PBXFv32vL5Byh5OF7f0pTAVIJUbq-2zEb5FJ9SbX0/w:720/sm:1/enc/1C5dMYIyfVii-pdq/RlWVj-Cc6fjhWQHr/qVBfmyUPSq1G04n9/rgMQzV4hfwsUXxuT/aVHu6l2iW2E3-NnM/2YGL4gsIY5mopMFi/i-ZC85PXNIMBCBy1/MBKOATT7lmWACWXs/FOSnhw7EcmT85kkb/2oQ89a7lpmvz2p7g/oyQjatI5mVWWb7p5/GmGoPV14K-XQZ1iF/jOTRFtZqSzSjceel/3umo2Q.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/e-yLVBJTUux7nA6a2E06a9FQ0KdzvyZvhUhPdcY3-94/w:720/sm:1/enc/z926h-j-U7OPP7Xx/4MjaiJ4yzis6xUx8/xkoUxBWNvJ9ynVFt/Qp2-5rKL9o1MyoUY/guBDuM_cRSw0IW2D/vVQJ4Syq4F__IVP2/ekOcI0jUgykPGqrU/7SNtw71bIF60P0aX/IPcmxwshZqIY3xkU/O-CzTbuzrRl-tYls/HWGWbTIADxx4mBAk/f3V_PGvJ_MExx1ck/prZqOU87dK4c8ytO/OhDBAA.jpg","angle":"back","index":1},{"url":"https://imgproxy.fourthwall.dev/pzilxCdnCWbnt3R5wTqMTF5aMLXpH4H9uNoLHrWJO08/w:720/sm:1/enc/3WPr8ZLp6DWjBDc_/7SZL5JrOHaaRBiCC/zNvar_HdA_IDGmi5/IbOUWPc8zsDwUDDF/wr9DB2OfL6gmkyax/HmF6Em4239O8wwU_/eSy-_lwkhYC1tmEF/DqE2B-d9IvtsgwNU/qPg4ILXMxzQHCsS8/Rbo9yglbNRmcYAh7/GBgKpJF82t1IqZaX/ruT_VSBqMw-pm44P/EIDMvZ81JmIc4eXM/k2JR5A.jpg","angle":"side","index":2}]},{"name":"Black","hex":"#000000","photos":[{"url":"https://imgproxy.fourthwall.dev/rNAfOnGyhnSPNvT37WJca1ASzjg9DJZE6U_tLG-5dDU/w:720/sm:1/enc/RpzA8xuJe3zjLzuP/dxb_Amay3sGkHDjl/z8mGY5WArSSR-Iz6/ZJGwZLXGbyTanRo4/xnqGf5xWJR9RFV-G/qqw78MYpmMpUIU_g/iqXEgLi_xc8jOf5f/rsxrBQf4CrjqXLwy/tioC1zZ6xuKBYrWM/LSMq-Zgu5XjlIRXo/5BBitP5L87yq2opL/EfsbiiH6T4RoB4k8/su-Xt7PB92D50VNp/aosB6g.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/OnF0GddcMSZPL7SfSQFR0DB_kBELfoEfCNiK8AoZuDg/w:720/sm:1/enc/71hfGTzWjKGa4ySR/Ikll5prwxDlFiUar/esi8oWgw1AwEbaSI/9l8lf1NNbPTV6b83/Bt2fO5EYUwAJ0-eE/a3HvSodG6a5lFKOP/S_QWWHy5QS6psNj5/GNOwxTrOhjm6f_Eo/9HUetOF8oryiwza9/X5pW_iztY6gTIXb-/TCH10EyvfHSe_6h1/v9HmMeq8PpBEdzg8/aXU_V9932GjaucYm/BhfT-Q.jpg","angle":"back","index":1},{"url":"https://imgproxy.fourthwall.dev/HcVrwWmAIKHKEo051uihRTvVVVsiyGEwVe5BAWhAgVk/w:720/sm:1/enc/CZ2lDtGf6iTDUNT-/wL4tV5F8qYdd1nz1/JYNZA4awvCxpjyBw/pwu-4GBTDgxcJ3Od/i7X10Su5zzDNAAS4/ZiiLjiNYtFi6RBYq/laj99kWH7DeMwot_/BM0QT4kDsNY5j8Qu/OrX2JTiyEmLEjTBy/8EBSRxQqtLKeE4RA/7xvekhXQ226cJRVm/8IiDSLaVCAWjCm2Y/AzBr19JsCpPWPFeo/JqRp8g.jpg","angle":"side","index":2}]},{"name":"Navy","hex":"#050C1D","photos":[{"url":"https://imgproxy.fourthwall.dev/JLcmbGpzd7xLYInRwfEHZNidc8O2M83y1mB0837Pkd0/w:720/sm:1/enc/l6wXBJk0mjKzDOnw/3AG0L8_4T1ExXjsb/j55xklXTHdadHJ3N/cmALFNXFccweiP7s/-3cMb2ixrPDelMiL/dQyfP2Cta5wRopIf/hDKOd0aKrY-Z5NRh/j_uLJQBRIXUlNTCC/HWGLWw7291aGHQ03/q0BqLslP0GcKRFGt/io6fTaOhtaqTovsU/znnfoa5luT2PwD9O/LfXRajhbeIRYB73B/0KYg4g.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/wxI6-IKdwAcvL-9qVUeY353cuU4KnmHfwjbadbWILLk/w:720/sm:1/enc/yogIF5EPQl8hWv4F/A1yiZ11ABoQEXl4s/jiLnqbLtvDEcgrwT/a48nTmvERP_DHdLp/SxOYrPsIvRiyNl7H/DyvOaAM25Q_jxh1U/Ye5mpjCGx41WzORp/EWA393sP527mLPgy/-0UUcwWoFpaZjfXQ/Vll6kz1sJDFrO3ja/AeOnWBPIOSyV9g_J/NYwFDBX_mUv9LwO8/wtHqtJic2d6Es5DQ/Pbaabg.jpg","angle":"back","index":1},{"url":"https://imgproxy.fourthwall.dev/4-fF2LtnAwig0uCES7x5bGaiiQhYFU2m9l9BKRQyVX0/w:720/sm:1/enc/UNN2iyoy0QnZstaQ/ULDy0wW8yAB4ZWwo/6v9TjwwB5A1Zq9gr/zi1pstyCw0r5uF19/bxaSJSo3pp_U_0T4/_w4Y9DlOBkSfXv5O/7DwKBtWFEQiK1wuY/wXH633-tBHiJa7wX/PvYwvxzmJf3gDPq6/W-sqvgVeUoonHd8C/5nMCFAu9KvYpdPEU/1kth4ZQDlc-4aLwV/7mqJhZHaaHuJcEqZ/GyRqAw.jpg","angle":"side","index":2}]}]},"tank":{"templateId":"pro_xPL7YjOBRQWVL50Im8eKAA","name":"Bella+Canvas Jersey Tank","label":"Tank top","basePrice":14.2,"defaultColor":"Black","logo":"inside","apparel":true,"sizes":["XS","S","M","L","XL","2XL"],"regionId":"front","w":1800,"h":2400,"areas":[{"regionId":"front","name":"Front","pixelsWidth":1800,"pixelsHeight":2400,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"back","name":"Back","pixelsWidth":1800,"pixelsHeight":2400,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"label_inside","name":"Inside Label","pixelsWidth":450,"pixelsHeight":450,"dpi":150,"renderable":false,"available":true,"suitsDesign":false,"suitsLogo":false}],"colors":[{"name":"White","hex":"#FFFFFF","photos":[{"url":"https://imgproxy.fourthwall.dev/kY1iLxr7X-lKvumuqCrHr4jIHOp5vrvsZld1yIdPcdo/w:720/sm:1/enc/r6c2IABsUl2Lwwjn/2q6Abrz-v4GOz8im/NJtb7RLBxlKt-M_i/Xogw1NE3FaVbpe4z/2GZ-NZp_AmdXosi4/WngR9c8OG39bjOmg/1qZYmHFYXHXtPDMP/-igpaMEr9mXJaOGM/GvBgcU-NhwZw5Bhx/hFmewyBZ_8_-wXU1/E0Q7bF0uL7S89NA1/OJOrSLilQRpymiI5/sKk-6aV9ryxuvAvA/KRP_OA.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/VNGUbYPiBfWr-mCi8-bWPqOoP0KUtWrJ18cGsuPC3B0/w:720/sm:1/enc/v5Wow-b_PsvKJvas/Wj8toO7ScDX-vwBl/T9WTSaXxJujPKe44/MMj7cJZtJbjBc79e/YKhfU2dx8Eylu21M/VdqC07uIL12FPxAo/jPY2v_Mr-BtV2muC/DxOQf5b13wnfXNbE/8aN-HITMtPPmseTA/WKwIanYKMK1GoaYl/exBjpMDZe-FYNVda/Rf84iE_SURMxJUUg/yhtCNINLUvwpAFQN/aFKWpQ.jpg","angle":"back","index":1},{"url":"https://imgproxy.fourthwall.dev/WldlQPIPNq1Wjpif78c3LrCtqmHnlrj2cUzTOUXkpcU/w:720/sm:1/enc/jWH6vVlO3KkOBeJG/rgMr11LZTUbvovGg/dNHhKlfwPPfLRPIs/TiL_1PXscvw8ElaC/irp97iKYdmGR-w79/gkcszb6A2iviQ7Uh/KCbXrjbD0ZgSbXTA/sD7IASF8iyZpCFDB/K9LXYp5cz0I9ApN_/5_MLyk_mgquKL8bL/9jgehJ1YoGHRYX_-/7sNBi2Z4QayoV-gJ/z6SVXZ_4ME3Lg5zb/wna-Kg.jpg","angle":"front","index":2}]},{"name":"Black","hex":"#000000","photos":[{"url":"https://imgproxy.fourthwall.dev/BqHU1Pr-7lTdi_050mSFz7L0Y-HXVyF071Lm1umvrPo/w:720/sm:1/enc/GT3O1MG4DN5X2fYc/vfyjTPmhT0DTZsRy/DH3m5mzqSj68fHYq/UepNQeY9Na_iPJ94/5rOW7vaqRFcibtt8/NNBZ4Fjuiz6rsU9P/29DYdRycxMD24c6G/78Fa87Pw2wioSmEg/Fwf9lry_X3c0-L_7/e1JK7pRVeN3co93K/Ws8b65AmaLSf3B8Q/uEDLXbzkExhpmyHM/IRD1DLH0zm2SvbNl/wS9_8Q.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/0KurpWPq_Q_AiRg9J212wV1yI9LHf58y-gqenhJMMA0/w:720/sm:1/enc/98PUFUwtsfvi8Zy0/Q3OQ0fFixnaUcfHR/MKHSbYzdTGz1dGQ3/9nd9y3hlTN7Nq5P1/vrGhAYP9DhuMhnOz/r2lvgsXqdmYgvT2d/PCek8B_T2fjbZQda/DYAjdA3RgT5cdTRN/h26B_4ZmMBbDBGRl/Sp4ugSwpwNdCMjfG/-32jwt_Jqnmc3_WQ/TVSmiq09Rkvss5f5/A5E3HlTrPlmAuKHK/SdTTqw.jpg","angle":"back","index":1},{"url":"https://imgproxy.fourthwall.dev/PO8mXjpRJejfwa8WUaCIumZtT3lcST3AGJyhmkxEZTY/w:720/sm:1/enc/G1oMkBii-4Nquv9D/IIk9-8XtooR1DVil/KfEUQs7__Go7XBlG/9NCoLGuW7wSDnLh_/6byXEsaYbjCOesjt/AhOUDnMpMOIdU9hT/-V8MTm661DgDRwR4/sGgTXEqVcnOWYXfC/W1KZKYma9j2xqh8f/QsnvmIu2OzmP2Rla/Zk3S_wbjS3q0-7qY/ew6MxKERY6THtKTh/HVblHjwbrHRM4Lc0/wgp7Gw.jpg","angle":"front","index":2}]},{"name":"True Royal","hex":"#104184","photos":[{"url":"https://imgproxy.fourthwall.dev/tOkmPtBGNRkxWP_WMc7Rp5EfAm1_81dVsTaKkCfGhxY/w:720/sm:1/enc/pPRXM9nVX--heQS1/edtsNqaFMaWqVXgW/vliRNr_SkCarxtjW/eIjo-X_DqWdQBYlE/wy8lf2neqaxsH5Xa/vss5RYuCDTOUt-qz/a-TCEmI6cOevcw8Z/G6rCqXwNXooK_d6B/yjgYW3_ivX9ZkU6g/8biulY6oO-GiURnj/-nyznDBF-pu_nNuc/ov8V4QZRR-N20GhL/FdeB-2R1SoHP8Boq/r7iWEg.jpg","angle":"front","index":0},{"url":"https://imgproxy.fourthwall.dev/AqfVku7p6rJwmDg0WwNWJ-nVTYyoIKtak3rYhcSiGG4/w:720/sm:1/enc/k0UCth6G5q8dbisN/SCwFWqbEdO9j-vOu/s9DYlAc_pavXaRTB/-f5woCN2b8ckJeYa/xhuP2tx4FGePYeGn/apFq2fa3CbOHnx1n/ZmpwH5cQFeSE7Dkl/h8HxLX_NyR_wakTH/Z21plGA5Hk3ePYrg/jQFnWakHXbvYSDyQ/ue5SZ8J0qtE7vSds/NtXCFqNpPvdWNf8U/s5pNAl9byRHca8CG/9zCCRg.jpg","angle":"back","index":1},{"url":"https://imgproxy.fourthwall.dev/CEfpJdmZ44NtQfgo1baTMD5rt7-3q8ppP0iVWkLeMgg/w:720/sm:1/enc/P_tOi2c7vPMJAQiZ/uRGvWB31lQXozAzL/EvtvIACUdPrbd7Ih/Ma3Qyeu2V0ojiC0e/SqHKM-URwqMl5zGX/2C9jmGxvlT7aFKLw/k5k596NSiXHl9tYU/ZsYoOJuXvwP-a6Qr/Eq6elfnZ6-7JxFVe/VyosWW4cJbVFFIYo/3tX0i6Xan87_o8u0/xT4icINjIdCTq6XF/F7QCkeHtVDYjRZRp/aWddgg.jpg","angle":"front","index":2}]}]},"youth":{"templateId":"pro_ODh_gv0ESl6jIcRfvSww0w","name":"Gildan Youth Classic Tee","label":"Youth tee","basePrice":9.69,"defaultColor":"White","logo":"inside","apparel":true,"sizes":["XS","S","M","L","XL"],"regionId":"front","w":1500,"h":1800,"areas":[{"regionId":"front","name":"Front","pixelsWidth":1500,"pixelsHeight":1800,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"back","name":"Back","pixelsWidth":1500,"pixelsHeight":1800,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"label_inside","name":"Inside Label","pixelsWidth":450,"pixelsHeight":450,"dpi":150,"renderable":false,"available":true,"suitsDesign":false,"suitsLogo":false}],"colors":[{"name":"White","hex":"#E4E4E4","photos":[{"url":"https://imgproxy.fourthwall.dev/Mwx6tO5269uacK7VDQt5c9W3UzmY40rvCsOMyEsIjGs/w:720/sm:1/enc/1Mi_Kgt1mwcm5iXw/5R79hOgiR6rmad1r/wJZDrouOeuJ9UuXo/bHPe-yJJ4PNhCvr2/Gb45vUkzF-VqtGiS/Sw-ViQVyEjLwfqUB/biInto7RwE11q5mM/mDGr8suClfbybaVk/RN7oV_bBsSWZXfzD/F8ToUKQqVOQ62sau/_Qr02qAkmOH-8ISZ/slj26fFKLMUjg8iJ/S2Cgk_9LVTeGw4WI/DbHpRw.jpg","angle":"flat","index":0},{"url":"https://imgproxy.fourthwall.dev/78OIXAtRGLNeurV8LEQeChKQ3rR1XnmRFq9O0T36nFY/w:720/sm:1/enc/XEnfvWHSIcMscWC6/X5Igz0-e2vWkgPeK/mbVwDdROLZpBPIT0/cIJRZ_oYvDWuWYoB/dgutvIr6FCX8H-Sw/DOyh-K3alAA3ItZx/UgWJi6nB8xR-N7Ii/xUJmELeN8Bd1BTQo/y2IPwDn95gufpc3e/hWuAb1k2dMR0t3XX/WjnZEZbd6WQuFFnp/Uj3DViz-6DLz5Tsx/-7eNXoB65RYpMa6Z/yD50ww.jpg","angle":"flat","index":1}]},{"name":"Black","hex":"#272727","photos":[{"url":"https://imgproxy.fourthwall.dev/xHw0YZVJEFcQVz65YDCu0tGzM5Z2aj4phkjMxw4-2Dg/w:720/sm:1/enc/yN9sJWLHX63Dz4jj/dtH9iKTpnxrM0Ej8/PErwNy42Ep2sRZBO/8HIP6U7ywidAbz_W/JV6L-FzpzbaWHBF9/ZmdqWIN1_16nbELI/jxh4XkqTfJ-uetxk/X_vLeB0NPvSqH5r_/gRjDtcxXAhveJIkC/9E06Cd-eURLI2V2N/u_6a_bvPNbIhCo-F/4if8GeRqNzrAxcVj/ZkdIrpP01aujGyO7/0oPDGw.jpg","angle":"flat","index":0},{"url":"https://imgproxy.fourthwall.dev/X_0uGQ-02vleaezEqTOpG3-OxiOUQGIits25KNtRxFk/w:720/sm:1/enc/c80zLdG4n42a_Ewi/rmSMWngU8t6bPHhu/8Sj5NQbAGW5IPj8i/W4G3dR3APaeiV9Ig/GtkI7ih4sAGV0Fm9/zrhYoNxZh5xJzevD/XuMWFdZSGzz-EP1s/de7mH43FahTSceH_/IuoBdnR0zbdlmw5t/M7_Iws8M6nTgwEgQ/WTB3mYNSv8p0arcQ/pRgwanZ0Sll2VaXT/k9iJLXeNw_tHONvv/4YKw2Q.jpg","angle":"flat","index":1}]}]},"tote":{"templateId":"pro_367","name":"Econscious Eco-Friendly Tote Bag","label":"Tote bag","basePrice":15.56,"defaultColor":"Oyster","logo":"inside","apparel":false,"sizes":["One size"],"regionId":"front","w":1500,"h":1500,"areas":[{"regionId":"front","name":"Front","pixelsWidth":1500,"pixelsHeight":1500,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false},{"regionId":"back","name":"Back","pixelsWidth":1500,"pixelsHeight":1500,"dpi":150,"renderable":true,"available":true,"suitsDesign":true,"suitsLogo":false}],"colors":[{"name":"Oyster","hex":"#F6EBCD","photos":[{"url":"https://imgproxy.fourthwall.dev/yde93PfhzUHi3l54zuGSHSB4_MGSXGuLr_kMEmf5SqE/w:720/sm:1/enc/q1GQkXQk4WLatvtD/iZyBQ2Mx30aoqxgr/0WLXF_y1QJLyqZD6/TH_6uPkAjpkiVvAp/om0eg_zdo4i31mLj/kkyDb8twU2uyjNIT/hjtewo2IEYMWDjgT/VRmOHtL7tWKAu03v/2io0JPB_-cDo39fF/2q2z0YWdeXzIUNEm/MUF3Z94IEgM.jpg","angle":"front","index":0}]},{"name":"Black","hex":"#060606","photos":[{"url":"https://imgproxy.fourthwall.dev/l2zgcyyYjyzs9LnT2JGpi3xZLyf2GEqQYgSzMufp0O0/w:720/sm:1/enc/bCMBz5dMbomqkd_5/oeTxdCEELS4m4PCZ/ALvMJx4zmNRXOXU8/KLsJRlCqd7MZt0j4/wcaFogi57r5qXnYq/p0s-m9wzqAiFjqfA/kU_wcihJGdEQaQum/uljJAS5u1s5i04Yt/rClOEiad-F5E-o-e/_v7_Mx5ZkOvC4NjB/dtCJ3oPD1K0.jpg","angle":"front","index":0}]}]}};
  const SUGGEST = { tee: 25.99, longsleeve: 31.99, crewneck: 39.99, tank: 27.99, youth: 21.99, tote: 29.99 };
  const fwTemplate = kind => {
    const b = FW_BLANKS[kind];
    const colors = b.colors.map(c => ({ ...c, base: b.basePrice, photos: kind === 'tee' && c.name === 'White' ? c.photos.map(p => p.url) : c.photos.map(p => ({ ...p })) }));
    return { blank: kind, kind, label: b.label, templateId: b.templateId, name: `${b.name} (sample)`, basePrice: b.basePrice, suggestedPrice: SUGGEST[kind], source: 'sample', defaultColor: b.defaultColor,
      printSpec: spec(b.templateId, b.regionId, b.w, b.h, 150), colors, sizes: b.sizes, areas: b.areas, logoMode: b.logo, apparelFlag: b.apparel };
  };
  // Server v2 fields: kind, apparel, minDpi, wrap, logo 'area'|'inside', pricing { suggested, margin, base }; merch7: multiColor.
  const v2 = (t, apparel, minDpi, wrap = false) => {
    const { logoMode, apparelFlag, ...rest } = t;
    const ap = typeof apparelFlag === 'boolean' ? apparelFlag : apparel;
    return { ...rest, apparel: ap, minDpi, wrap, logo: logoMode || (ap ? 'area' : 'inside'), multiColor: (t.colors || []).length > 1, printSpec: { ...t.printSpec, kind: t.kind, minDpi, wrap }, pricing: { suggested: t.suggestedPrice, base: t.basePrice, margin: Math.round((t.suggestedPrice - t.basePrice) * 100) / 100 } };
  };
  // One template per blank (merch v2: templates with no `blank` = all blanks).
  const TEMPLATES = [
    fwTemplate('tee'), fwTemplate('longsleeve'), fwTemplate('crewneck'),
    { blank: 'hoodie', kind: 'hoodie', label: 'Hoodie', templateId: 'tpl-hoodie-sample', name: 'Pullover hoodie (sample)', basePrice: 29.5, suggestedPrice: 47.99, source: 'sample', defaultColor: 'Black',
      printSpec: spec('tpl-hoodie-sample', 'front_large', 1650, 1650, 150),
      colors: [{ name: 'Black', hex: '#101114' }, { name: 'White', hex: '#FFFFFF' }, { name: 'Navy', hex: '#0B1F3A' }, { name: 'Grey', hex: '#8A8D8F' }],
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      areas: [area('front_large', 'Front', 1650, 1650, true, false), area('back_large', 'Back', 2250, 2700, true, false), area('sleeve_left', 'Left sleeve', 600, 525, false, true), area('back_neck', 'Back neck', 750, 300, false, true)] },
    fwTemplate('tank'), fwTemplate('youth'), fwTemplate('tote'),
    { blank: 'poster', kind: 'poster', label: 'Poster', templateId: 'tpl-poster-sample', name: 'Matte poster 5×7 (sample)', basePrice: 11.2, suggestedPrice: 21.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-poster-sample', 'default', 1500, 2100, 300), colors: WHITE, sizes: ['5×7'],
      areas: [area('default', 'Print', 1500, 2100, true, false, 300)] },
    { blank: 'sticker', kind: 'sticker', label: 'Sticker', templateId: 'tpl-sticker-sample', name: 'Kiss-cut sticker 3×3 (sample)', basePrice: 2.6, suggestedPrice: 6.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-sticker-sample', 'default', 900, 900, 300), colors: WHITE, sizes: ['3×3'],
      areas: [area('default', 'Print', 900, 900, false, true, 300)] },
    { blank: 'mug', kind: 'mug', label: 'Mug', templateId: 'tpl-mug-sample', name: 'Ceramic mug 11 oz (sample)', basePrice: 7.9, suggestedPrice: 15.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-mug-sample', 'default', 2700, 1050, 300), colors: WHITE, sizes: ['11 oz'],
      areas: [area('default', 'Wrap', 2700, 1050, true, false, 300)] },
  ].map(t => v2(t, !['poster', 'sticker', 'mug', 'tote'].includes(t.kind), ['poster', 'sticker', 'mug'].includes(t.kind) ? 300 : 150, t.kind === 'mug'));
  const CONCEPTS = [
    { id: 's1', collection: 'replay', title: 'Sample Lakers bench era', team: { id: 'lal', name: 'Los Angeles Lakers' }, palette: { a: '#552583', b: '#FDB927', ink: '#FFFFFF' }, garment: { color: '#FFFFFF', name: 'White' },
      stack: [{ text: 'Kobe', size: 'big', fill: 'a', ink: 'ink' }, { text: 'Smush', size: 'big', fill: 'b', ink: 'ink' }, { text: 'Luke', size: 'big', fill: 'a', ink: 'ink' }, { text: 'Kwame', size: 'big', fill: 'b', ink: 'ink' }, { text: 'Mihm', size: 'big', fill: 'a', ink: 'ink' }],
      align: 'center', blanks: ['tee'], rights: [{ kind: 'name', text: 'Kobe, Smush, Luke, Kwame, Mihm' }, { kind: 'team', text: 'Lakers colours' }], why: 'A roster only real fans remember.' },
    { id: 's2', collection: 'quote', title: 'Ball don’t lie', team: null, palette: { a: '#FFFFFF', b: '#033162', ink: '#1257B8' }, garment: { color: '#ED0739', name: 'Red' },
      stack: [{ text: 'Ball don’t lie', size: 'big', fill: 'white', ink: 'ink' }], align: 'center', blanks: ['tee'], rights: [{ kind: 'quote', text: 'Ball don’t lie' }], why: 'Short, exact and instantly known.' },
    { id: 's3', collection: 'nickname', title: 'Megatron', team: { id: 'det', name: 'Detroit Lions' }, palette: { a: '#B0B7BC', b: '#0076B6', ink: '#0076B6' }, garment: { color: '#020718', name: 'French Navy' },
      stack: [{ text: 'Megatron', size: 'big', fill: 'a', ink: 'ink' }], align: 'center', blanks: ['tee'], rights: [{ kind: 'nickname', text: 'Megatron' }, { kind: 'team', text: 'Lions colours' }], why: 'Almost famous: one word, one era.' },
    { id: 's4', collection: 'core', title: 'We center fans', team: null, palette: { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' }, garment: { color: '#FFFFFF', name: 'White' },
      // merch5: one pill in a custom colour (a hex row; the engine never swaps it).
      stack: [{ text: 'We center', size: 'big', fill: 'a', ink: 'ink' }, { text: 'fans', size: 'big', fill: '#E4002B', ink: '#FFFFFF' }], align: 'left', blanks: ['tee'], rights: [], why: 'An ES line, ours to sell, with one pill in a custom red.' },
  ];
  // Pro adds a plan and richer layouts, two with extras (elements) beside the pills.
  const PRO_CONCEPTS = [
    { id: 'p1', collection: 'current', label: 'Big number', title: 'Sample: 50 on the night', team: { id: 'lal', name: 'Los Angeles Lakers' }, palette: { a: '#552583', b: '#FDB927', ink: '#FFFFFF' }, garment: { color: '#FFFFFF', name: 'White' },
      stack: [{ text: 'Fifty', size: 'big', fill: 'a', ink: 'white' }, { text: 'On the night', size: 'mid', fill: 'b', ink: 'ink' }], align: 'center', blanks: ['tee'], rights: [{ kind: 'team', text: 'Lakers colours' }], why: 'The number fans repeat, big behind the words.', mode: 'pro',
      elements: [{ type: 'number', text: '50', style: 'outline', color: 'b', position: 'behind' }, { type: 'rule', position: 'below', color: 'a', weight: 'thick' }] },
    { id: 'p2', collection: 'replay', label: 'Crowned', title: 'Sample: the comeback', team: null, palette: { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' }, garment: { color: '#020202', name: 'Black' },
      stack: [{ text: 'The comeback', size: 'big', fill: 'a', ink: 'white' }, { text: 'Nobody saw it coming', size: 'small', fill: 'white', ink: 'a' }], align: 'left', blanks: ['tee'], rights: [], why: 'A crown over the line says it all without a logo.', mode: 'pro',
      elements: [{ type: 'icon', name: 'crown', position: 'above', color: 'white' }] },
  ];
  const PLAN = {
    basic: { idea: 'Keep the line whole and let the pills do the work.', angle: 'Clean ES stacks in team colours.' },
    pro: { idea: 'Sell the moment fans are already quoting: the line in full, then the number and the comeback.', angle: 'Lead with the exact words; add one bold extra where it helps the story.' },
  };
  const MOMENTS = [
    { id: 'm1', audience: 'Sample City fans and rookie-card collectors', timing: 'now', collection: 'current', ai: true, lines: [{ text: 'FIFTY ON THE NIGHT', angle: 'stat' }, { text: 'ROOKIE NIGHT', angle: 'callback' }, { text: '50 AND COUNTING', angle: 'chant' }], title: 'Sample: a rookie drops 50 in his first start', sport: 'nba', sportLabel: 'NBA', team: { name: 'Sample City', short: 'Sample City' }, kind: 'stat', score: 91, why: 'A rookie scoring 50 is the night fans retell for years; a round number reads from across the street.', line: 'FIFTY ON THE NIGHT', trend: { id: 't1', title: 'Sample: a rookie’s 50-point night', sport: 'nba' } },
    { id: 'm2', audience: 'NBA fans who grew up on the line', timing: 'season', collection: 'quote', ai: true, lines: [{ text: 'BALL DON’T LIE', angle: 'quote' }, { text: 'THE BALL KNEW', angle: 'pun' }, { text: 'KARMA ON THE COURT', angle: 'callback' }], title: 'Sample: “Ball don’t lie” is back after a wild finish', sport: 'nba', sportLabel: 'NBA', team: null, kind: 'quote', score: 86, why: 'The phrase is already part of how fans talk, so the shirt explains itself at a glance.', line: 'BALL DON’T LIE', trend: { id: 't4', title: 'Sample: “Ball don’t lie” after a wild finish', sport: 'nba' } },
    { id: 'm3', audience: 'Packers fans after a cold-weather home win', timing: 'week', collection: 'current', ai: true, lines: [{ text: 'FROZEN TUNDRA', angle: 'nickname' }, { text: 'SNOW GAME SZN', angle: 'chant' }, { text: 'LAMBEAU OR BUST', angle: 'city' }], title: 'Sample: the Packers beat the Rams in the Lambeau snow', sport: 'nfl', sportLabel: 'NFL', team: { name: 'Green Bay Packers', short: 'Packers' }, kind: 'moment', score: 78, why: 'A snow game at Lambeau turns a whole fan base into storytellers for a week, and they want something to wear to the next home game.', line: 'FROZEN TUNDRA', trend: { id: 't2', title: 'Sample: Packers top the Rams 24-17 in the Lambeau snow', sport: 'nfl' } },
    { id: 'm4', audience: 'Fans who were there for the first save', timing: 'season', collection: 'nickname', ai: true, lines: [{ text: 'THE CLOSER', angle: 'nickname' }, { text: 'LOCK IT DOWN', angle: 'chant' }, { text: 'NINTH INNING MAN', angle: 'callback' }], title: 'Sample: “The Closer” earns his nickname', sport: 'mlb', sportLabel: 'MLB', team: null, kind: 'nickname', score: 72, why: 'A nickname fans are just starting to use feels like an inside joke; early merch rides that.', line: 'THE CLOSER', trend: { id: 't3', title: 'Sample: a walk-off in extra innings', sport: 'mlb' } },
    { id: 'm5', audience: 'Both clubs’ fans, derby week', timing: 'week', collection: 'current', ai: true, lines: [{ text: 'DERBY DAY', angle: 'rivalry' }, { text: 'PICK A SIDE', angle: 'chant' }, { text: 'ONE CITY TWO COLOURS', angle: 'rivalry' }], title: 'Sample: the rivalry renewed in the derby', sport: 'others', sportLabel: 'Soccer', team: null, kind: 'rivalry', score: 64, why: 'Derby week is when both sides buy to pick a side, and both can wear the same line.', line: 'DERBY DAY', trend: { id: 't5', title: 'Sample: the derby rivalry renewed', sport: 'soccer' } },
  ];
  // Free-mode style intents, done in code (the real server uses the AI first).
  const INTENTS = [
    [/short|trim|less/i, c => { const keep = c.stack.filter((r, i) => i === 0 || r.size !== 'small'); return keep.length < c.stack.length ? [{ ...c, stack: keep }, 'Dropped the small lines so the main words carry it.'] : c.stack.length > 1 ? [{ ...c, stack: c.stack.slice(0, -1) }, 'Removed the last pill.'] : [c, 'It’s already one pill.']; }],
    [/team colou?r/i, c => (c.team?.id === 'lal' ? [{ ...c, palette: { ...c.palette, a: c.palette.b, b: c.palette.a } }, 'Switched to the other Lakers colour first.'] : [{ ...c, palette: { a: '#552583', b: '#FDB927', ink: '#FFFFFF' } }, 'Used Lakers purple and gold (sample team colours).'])],
    [/nickname/i, c => (c.stack.length >= 10 ? [c, 'That’s already 10 pills, the most a design can have.'] : [{ ...c, stack: [...c.stack, { text: (c.rights || []).find(r => r.kind === 'nickname')?.text || 'Showtime', size: 'small', fill: 'b', ink: 'ink' }], rights: [...(c.rights || []), { kind: 'nickname', text: 'Showtime' }] }, 'Added the nickname as a small line under it.'])],
    [/bold|big/i, c => [{ ...c, stack: c.stack.map(r => ({ ...r, size: 'big' })), fit: { ...(c.fit || {}), scale: Math.min(1.6, ((c.fit && c.fit.scale) || 1) * 1.2) } }, 'Made every pill big and the print 20% larger.']],
    [/smaller/i, c => [{ ...c, fit: { ...(c.fit || {}), scale: Math.max(0.6, ((c.fit && c.fit.scale) || 1) * 0.85) } }, 'Made the print 15% smaller.']],
    [/cent(re|er)/i, c => [{ ...c, align: 'center' }, 'Centred the stack.']],
    [/left/i, c => [{ ...c, align: 'left' }, 'Lined the pills up on the left.']],
    [/dark|black tee/i, c => [{ ...c, garment: { color: '#020202', name: 'Black' } }, 'Put it on a black tee. Pills that melt into black switch to white.']],
    [/white tee|light/i, c => [{ ...c, garment: { color: '#FFFFFF', name: 'White' } }, 'Put it on a white tee.']],
    [/swap/i, c => [{ ...c, palette: { ...c.palette, a: c.palette.b, b: c.palette.a } }, 'Swapped the two pill colours.']],
  ];
  // Refine keeps custom (hex) rows as they are: intents copy rows ({ ...r }) and
  // only change palette keys, alignment, size or the garment (like the server).
  function refine(body, scenario) {
    const c = body.concept;
    if (!c || !Array.isArray(c.stack)) return [400, { ok: false, error: 'Pick a design first.' }];
    const text = String(body.instruction || '').slice(0, 300);
    const hit = INTENTS.find(([re]) => re.test(text));
    const simple = hit && !/team colou?r|nickname|bold/.test(String(hit[0]));
    if (scenario === 'free' && !simple) return [200, { ok: true, free: true, concept: null, designMode: body.designMode === 'pro' ? 'pro' : 'basic', error: 'Free mode can do: shorter, centre or left, swap colours, bigger or smaller, white or dark tee.' }];
    const pro = body.designMode === 'pro' && scenario !== 'pro-cap';
    if (!hit) return scenario === 'free' ? [200, { ok: true, free: true, concept: null, designMode: body.designMode === 'pro' ? 'pro' : 'basic', error: 'Free mode can do: shorter, centre or left, swap colours, bigger or smaller, white or dark tee.' }] : [200, { ok: true, concept: { ...c, title: c.title }, note: `Sample data: “${text.slice(0, 60)}” would go to the ${pro ? 'Pro' : 'Basic'} AI. Nothing changed.`, designMode: pro ? 'pro' : 'basic', mode: pro ? 'pro' : 'basic', ai: true, cost: { usd: 0, cached: false } }];
    const [next, note] = hit[1]({ ...c, stack: c.stack.map(r => ({ ...r })) });
    if (!pro) delete next.elements;
    return [200, { ok: true, concept: { ...next, mode: pro ? (next.mode || 'pro') : 'basic' }, note, designMode: pro ? 'pro' : 'basic', mode: pro ? 'pro' : 'basic', ai: !/short|cent|left|swap|smaller|dark|white/i.test(text), ...(body.designMode === 'pro' && !pro ? { fellBack: 'ai' } : {}), cost: { usd: 0, cached: false } }];
  }
  function concepts(body, scenario) {
    if (scenario === 'free') return [200, { ok: true, concepts: null, free: true }];
    if (body.designMode === 'pro' && scenario === 'pro-cap') return [200, { ok: true, free: true, concepts: null, plan: null, designMode: 'basic', fellBack: 'cap', note: 'Pro is paused: you’ve reached this week’s AI limit, so these are Basic designs.' }];
    const pro = body.designMode === 'pro';
    const list = pro ? [...CONCEPTS, ...PRO_CONCEPTS].map(c => ({ ...c, mode: 'pro' })) : CONCEPTS.map(c => ({ ...c, mode: 'basic' }));
    return [200, { ok: true, concepts: list, plan: PLAN[pro ? 'pro' : 'basic'], designMode: pro ? 'pro' : 'basic', mode: pro ? 'pro' : 'basic', ai: true, model: pro ? 'sample-best' : 'sample-main', cost: { usd: 0, cached: false } }];
  }
  const TRENDS = [
    { id: 't1', title: 'Sample: a rookie’s 50-point night', category: 'nba', rank: 90 },
    { id: 't2', title: 'Sample: the comeback nobody saw coming', category: 'nfl', rank: 80 },
    { id: 't3', title: 'Sample: a walk-off in extra innings', category: 'mlb', rank: 70 },
  ];
  const IMAGES = ['White', 'White', 'Black', 'Black', 'Navy', 'Heather grey'].map((color, i) => ({ url: MOCK, width: 1000, height: 1000, color, region: i % 2 ? 'back' : 'front_large' }));
  // Merch7: one product, several colours. colors must be the template's exact names (else 400 'colors').
  function colorsFor(body) {
    const t = TEMPLATES.find(x => x.blank === body.blank) || TEMPLATES[0];
    const names = t.colors.map(c => c.name);
    const asked = Array.isArray(body.colors) ? body.colors.map(String) : [body.color || t.defaultColor];
    if (!asked.length || asked.length > 12) return { error: 'Pick 1 to 12 colours.' };
    const bad = asked.find(n => !names.includes(n));
    if (bad) return { error: `This product doesn’t come in ${bad}.` };
    return { colors: [...new Set(asked)] };
  }
  const imagesFor = colors => colors.flatMap(color => [{ url: MOCK, width: 1000, height: 1000, color, region: 'front_large' }, { url: MOCK, width: 1000, height: 1000, color, region: 'back' }]);
  let product = null;
  const SHOP = 'https://sample-shop.example/products/';
  const COLLECTIONS = [{ id: 'col_fan', name: 'Fan favourites (sample)', count: 4 }, { id: 'col_replay', name: 'Replay era (sample)', count: 2 }, { id: 'col_core', name: 'Core ES (sample)', count: 3 }];
  const memberOf = {}; // productId -> collection ids
  const day = n => new Date(Date.UTC(2026, 10, 25 - n, 15)).toISOString();
  const LIST = [
    { productId: 'prod_s1', title: 'Ball don’t lie Tee (sample)', url: SHOP + 'ball-dont-lie-tee', state: 'PUBLIC', thumb: MOCK, blank: 'tee', color: 'Red', createdAt: day(2), createdBy: 'qa@essentiallysports.com', units30: 14, revenue30: 364 },
    { productId: 'prod_s2', title: 'Megatron Hoodie (sample)', url: SHOP + 'megatron-hoodie', state: 'HIDDEN', thumb: MOCK, blank: 'hoodie', color: 'Black', createdAt: day(5), createdBy: 'qa@essentiallysports.com', units30: 0, revenue30: 0 },
    { productId: 'prod_s3', title: 'We center fans Mug (sample)', url: SHOP + 'we-center-fans-mug', state: 'PUBLIC', thumb: MOCK, blank: 'mug', color: 'White', createdAt: day(9), createdBy: 'designer@essentiallysports.com', units30: 6, revenue30: 95.94 },
    { productId: 'prod_s4', title: 'Sample Lakers bench era Poster (sample)', url: '', state: 'ARCHIVED', thumb: '', blank: 'poster', color: 'White', createdAt: day(21), createdBy: 'designer@essentiallysports.com', units30: 1, revenue30: 21.99 },
  ];
  const listNow = () => LIST.map(p => ({ ...p, state: String(p.state).toLowerCase() })); // the server's list uses lowercase states
  // ─── Brainstorm room (modes brainstorm-open / -turn / -line / -add / -list) ─
  // A shared board per trend. The sample board is a Packers–Rams snow game;
  // any other trend or line gets lines built from its own words. Everything is
  // made up. The signed-in person is ME; two sample teammates seed the board.
  const ME = 'qa@essentiallysports.com';
  const MAYA = 'maya@essentiallysports.com';
  const JORDAN = 'jordan@essentiallysports.com';
  const ago = min => new Date(Date.now() - min * 60000).toISOString();
  const words = t => String(t || '').trim().split(/\s+/).filter(Boolean);
  const okLine = t => { const s = String(t || '').trim(); return s.length >= 2 && s.length <= 32 && words(s).length <= 6; };
  const normLine = t => String(t || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const hashKey = t => { let h = 0; for (const c of normLine(t)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); };
  const BANNED_LINE = /\b(NFL|NBA|MLB|NHL|NCAA|OFFICIAL|LICENSED)\b/i;
  const PACKERS = {
    context: {
      title: 'Sample: Packers top the Rams 24-17 in the Lambeau snow', sport: 'nfl', sportLabel: 'NFL', team: { name: 'Green Bay Packers', short: 'Packers' },
      colours: ['#203731', '#FFB612'], palette: { a: '#203731', b: '#FFB612', ink: '#000000' },
      headlines: [{ title: 'Sample: Packers top the Rams 24-17 in the Lambeau snow', source: 'Sample wire', url: '' }, { title: 'Sample: Rams fall short on a late fourth-down try', source: 'Sample wire', url: '' }, { title: 'Sample: the Lambeau crowd stays to the end in the snow', source: 'Sample wire', url: '' }, { title: 'Sample: Green Bay moves to 9-4 and into a playoff spot', source: 'Sample wire', url: '' }],
      esArticles: [{ title: 'Sample ES: how the Packers won the snow game', url: 'https://www.essentiallysports.com/', date: '2026-11-26' }, { title: 'Sample ES: the Rams’ fourth-down call, explained', url: 'https://www.essentiallysports.com/', date: '2026-11-26' }],
      facts: ['Sample check: the final score was 24-17.', 'Sample check: it was the coldest home game of the season so far.'], factUrls: [],
      nicknames: ['Frozen Tundra', 'Titletown', 'Cheeseheads'], notes: [],
    },
    pools: {
      chant: ['GO PACK GO', 'PACK IN THE SNOW', 'LOUDER IN THE COLD', 'HOLD THE LINE', 'SNOW GAME SZN'],
      pun: ['SNOW PROBLEM', 'BRRR-ILLIANT', 'CHEESE ON ICE', 'FROST AND FOUND', 'ICE COLD PACK'],
      nickname: ['FROZEN TUNDRA', 'TITLETOWN', 'THE PACK IS BACK', 'TUNDRA TOUGH'],
      stat: ['24-17 IN THE SNOW', 'IT ENDED 24-17', '9-4 AND COLD', '24 POINTS OF FROST'],
      rivalry: ['RAMS MELTED', 'TOO COLD FOR LA', 'WELCOME TO WINTER', 'LA GOT SNOWED'],
      era: ['FOOTBALL WEATHER', 'OLD SCHOOL FOOTBALL', 'SNOW GAMES NEVER DIE', 'THE WAY IT USED TO BE'],
      city: ['LAMBEAU OR BUST', 'GREEN BAY GROWN', 'SMALL TOWN BIG GAME', 'TITLETOWN WINTERS'],
      player: ['ICE IN HIS VEINS', 'QB1 IN THE SNOW', 'GLOVES OFF', 'BUILT FOR THIS'],
      troll: ['BRING A COAT LA', 'SUNSCREEN WON’T HELP', 'SEE YOU IN JANUARY', 'NO PALM TREES HERE'],
      funnier: ['SNOW PROBLEM', 'BRING A COAT LA', 'CHEESE ON ICE', 'BRRR-ILLIANT', 'FROSTBITE SZN'],
      emotional: ['WE STAYED', 'THROUGH THE SNOW', 'HOME IS LAMBEAU', 'COLD HANDS FULL HEARTS', 'WORTH THE FROSTBITE'],
      shorter: ['GO PACK', 'BRRR', 'FROZEN', 'STAYED', 'TUNDRA'],
      neutral: ['FOOTBALL WEATHER', 'SNOW GAMES HIT DIFFERENT', 'REAL FOOTBALL', 'COLD GAME HOT TAKE'],
    },
    rights: { 'FROZEN TUNDRA': [{ kind: 'nickname', text: 'Frozen Tundra' }], TITLETOWN: [{ kind: 'nickname', text: 'Titletown' }], 'TITLETOWN WINTERS': [{ kind: 'nickname', text: 'Titletown' }], 'CHEESEHEADS DON’T MELT': [{ kind: 'nickname', text: 'Cheeseheads' }] },
    why: { chant: 'A chant fans already shout, short enough to read from the stands.', pun: 'Wordplay on the snow: the joke lands before the second look.', nickname: 'The stadium’s nickname, worn like a badge after a home win.', stat: 'The score from the headline, so it’s exact.', rivalry: 'Pokes the Rams without a logo or a cheap shot.', era: 'Calls back to old-school cold-weather football.', city: 'Green Bay pride: small town, big game.', player: 'About the quarterback’s night without naming him.', troll: 'A friendly jab at the visitors from the warm side of the country.', funnier: 'Funnier: a joke a fan would say out loud.', emotional: 'For the fans who stayed to the end in the snow.', shorter: 'One or two words: the biggest type on the shirt.', neutral: 'Works for any football fan, not just Packers fans.' },
  };
  const ANGLES = ['quote', 'nickname', 'chant', 'callback', 'pun', 'stat', 'rivalry', 'era', 'city', 'player', 'troll'];
  // Lines for any other trend or line: built from its own words.
  const GENERIC_WHY = { chant: 'Short and loud: a line fans can shout.', pun: 'Wordplay on the moment.', nickname: 'A name fans already use.', stat: 'Numbers only from the sources.', rivalry: 'Picks a side without a logo.', era: 'Calls back to a moment fans remember.', city: 'Hometown pride.', player: 'About the player, no name needed.', troll: 'A friendly jab, in good taste.', callback: 'Brings back the moment in a few words.' };
  function genericPools(title) {
    const w = words(normLine(title).replace(/^(SAMPLE|YOUR LINE)\s*/, '')).filter(x => x.length > 3 && !/^(THE|AND|WITH|FROM|AFTER|THIS|THAT|NIGHT|YOUR|LINE|DONT)$/.test(x));
    const k = w[0] || 'THIS';
    const k2 = w[1] || 'MOMENT';
    return {
      chant: [`${k} ${k} ${k}`, `LET’S GO ${k}`, `${k} SZN`], pun: [`${k} OF THE YEAR`, `${k}-ING HAPPENS`], nickname: [`THE ${k}`, `MR ${k}`], stat: [`${k} BY THE NUMBERS`],
      rivalry: ['PICK A SIDE', 'NOT EVEN CLOSE'], era: ['ONE FOR THE ARCHIVE', 'REMEMBER THIS ONE'], city: ['HOMETOWN PROUD', 'OUR TOWN OUR TEAM'], player: ['BUILT FOR THIS', 'BIG GAME ENERGY'],
      troll: ['CALL IT A COMEBACK', 'SEE YOU NEXT YEAR'], funnier: [`${k} HAPPENED`, 'I WAS TOLD THERE’D BE DEFENSE'], emotional: ['WE WERE THERE', 'NEVER STOPPED BELIEVING'], shorter: [k, 'BELIEVE'], neutral: ['WHAT A GAME', `${k} ${k2}`.slice(0, 32)],
    };
  }
  const sessions = new Map(); // key -> { session, context }
  let lineSeq = 0;
  const line = (text, angle, by, source, extra = {}) => ({ id: `bl${++lineSeq}`, text, angle, why: extra.why || '', by, at: extra.at || new Date().toISOString(), starred: extra.starred || [], source, rights: extra.rights || [] });
  const peopleOf = s => [...new Set([...s.lines.map(l => l.by), ...s.turns.map(t => t.by), s.createdBy].filter(Boolean))];
  const publicSession = s => { const { pools, packers, ...rest } = s; return JSON.parse(JSON.stringify({ ...rest, people: peopleOf(s) })); };
  function seed(key, trend, content) {
    const packers = trend && (trend.id === 't2' || /packers|lambeau/i.test(trend.title || ''));
    const title = trend?.title || (content?.text ? String(content.text).slice(0, 60) : 'Your line');
    const ctx = packers ? { ...PACKERS.context } : { title, sport: String(trend?.sport || ''), sportLabel: String(trend?.sport || '').toUpperCase(), team: trend?.team || null, colours: [], palette: null, headlines: trend ? [{ title: trend.title, source: '', url: '' }] : [], esArticles: [], facts: [], factUrls: [], nicknames: [], notes: ['ES articles: none found (sample)', 'Web check: skipped (sample)'] };
    const context = { ...ctx, gatheredAt: new Date().toISOString(), sources: { trend: Boolean(trend), es: ctx.esArticles.length > 0, web: ctx.facts.length > 0 } };
    const s = { id: `bs-${hashKey(key)}`, key, storage: 'db', trendId: trend?.id || null, title: context.title, sport: context.sport, team: context.team, createdBy: packers ? MAYA : ME, createdAt: ago(packers ? 95 : 0), updatedAt: ago(packers ? 12 : 0), lines: [], turns: [], contextAt: context.gatheredAt, pools: packers ? PACKERS.pools : genericPools(title), packers };
    if (packers) {
      const a = [line('FROZEN TUNDRA', 'nickname', MAYA, 'ai', { at: ago(90), starred: [MAYA, JORDAN], why: PACKERS.why.nickname, rights: PACKERS.rights['FROZEN TUNDRA'] }), line('SNOW GAME SZN', 'chant', MAYA, 'ai', { at: ago(90), starred: [MAYA], why: PACKERS.why.chant }), line('LAMBEAU OR BUST', 'city', MAYA, 'ai', { at: ago(90), why: PACKERS.why.city }), line('24-17 IN THE SNOW', 'stat', MAYA, 'ai', { at: ago(90), why: PACKERS.why.stat })];
      const b = [line('CHEESEHEADS DON’T MELT', 'pun', JORDAN, 'person', { at: ago(40), starred: [JORDAN, MAYA], rights: PACKERS.rights['CHEESEHEADS DON’T MELT'] })];
      const c = [line('BRING A COAT LA', 'troll', JORDAN, 'ai', { at: ago(12), starred: [JORDAN], why: PACKERS.why.troll }), line('TOO COLD FOR LA', 'rivalry', JORDAN, 'ai', { at: ago(12), why: PACKERS.why.rivalry }), line('WE STAYED', 'callback', JORDAN, 'ai', { at: ago(12), why: PACKERS.why.emotional })];
      s.lines = [...a, ...b, ...c];
      s.turns = [
        { id: 'bt-seed1', ai: true, by: MAYA, at: ago(90), prompt: 'Lines for the snow game, Packers fans first', note: 'Leaned on the snow and Lambeau: the cold is the story fans are retelling. The score is from the headline.', lineIds: a.map(l => l.id), designMode: 'basic' },
        { id: 'bt-seed2', ai: true, by: JORDAN, at: ago(12), action: { kind: 'angle', angle: 'troll' }, note: 'Friendly jabs at the visitors, nothing mean, no logos.', lineIds: c.map(l => l.id), designMode: 'pro' },
      ];
    }
    sessions.set(key, { session: s, context });
    return sessions.get(key);
  }
  const TONE = { funnier: 'funnier', emotional: 'emotional', shorter: 'shorter' };
  // Pool keys that aren't angles map to one for the chip on the card.
  const POOL_ANGLE = { funnier: 'pun', emotional: 'callback', shorter: 'callback', neutral: 'callback' };
  // Round-robin across the pools, so padding mixes angles.
  const allOf = P => { const e = Object.entries(P); const out = []; for (let i = 0; i < 6; i++) e.forEach(([k, list]) => { if (list[i]) out.push([list[i], POOL_ANGLE[k] || k]); }); return out; };
  function pick(pool, board, n) {
    const have = new Set(board.map(l => normLine(l.text)));
    const out = [];
    for (const [t, a] of pool) { if (out.length >= n) break; const k = normLine(t); if (okLine(t) && !BANNED_LINE.test(t) && !have.has(k)) { out.push([t, a]); have.add(k); } }
    return out;
  }
  function mixOf(a, b) {
    const wa = words(a.text);
    const wb = words(b.text);
    const half = x => Math.max(1, Math.ceil(x.length / 2));
    return [[...wa.slice(0, half(wa)), ...wb.slice(-half(wb))], [...wb.slice(0, half(wb)), ...wa.slice(-half(wa))], [...wa.slice(0, 1), ...wb.slice(0, 2)]].map(x => x.join(' ').slice(0, 32).trim());
  }
  function turn(body, scenario) {
    const entry = [...sessions.values()].find(e => e.session.id === body.sessionId);
    if (!entry) return [404, { ok: false, reason: 'not-found', error: 'This board is gone. Open it again from the moment.' }];
    const s = entry.session;
    const act = body.action && typeof body.action === 'object' ? body.action : null;
    const prompt = act ? '' : String(body.prompt || '').trim().slice(0, 300);
    if (!act && !prompt) return [400, { ok: false, error: 'Ask for something, or pick an angle.' }];
    const P = s.pools;
    let pool = [];
    let angleFor = () => 'callback';
    let note = '';
    if (act?.kind === 'angle') { const a = act.angle === 'wordplay' ? 'pun' : act.angle; pool = P[a] || []; angleFor = () => (ANGLES.includes(a) ? a : 'callback'); note = { chant: 'Chants first: short lines fans can shout in rhythm.', pun: 'Wordplay on the moment, each one readable at a glance.', nickname: 'Built around the nicknames in the sources.', stat: 'Only numbers that are in the headlines or the fact check.', rivalry: 'Rivalry lines that poke without a logo or a cheap shot.', era: 'Callbacks to the old days, no dates I couldn’t check.', city: 'City pride: where the fans are from.', player: 'Player lines that don’t need a name on the shirt.', troll: 'Troll lines, in good taste: friendly jabs, nothing mean.' }[a] || 'New lines on that angle.'; }
    else if (act?.kind === 'tone') { pool = P[TONE[act.tone]] || P.funnier; angleFor = () => (act.tone === 'funnier' ? 'pun' : 'callback'); note = { funnier: 'Funnier: jokes a fan would actually say out loud.', emotional: 'More emotional: lines for the fans who were there.', shorter: 'Shorter: one or two words, so the type prints biggest.' }[act.tone] || 'Changed the tone.'; }
    else if (act?.kind === 'audience') { pool = P.neutral; angleFor = () => 'callback'; note = 'For neutral fans: lines any football fan would wear, no team needed.'; }
    else if (act?.kind === 'more-like') {
      const base = s.lines.filter(l => (act.lineIds || []).includes(l.id));
      const a = base[0]?.angle || 'callback';
      const w = words(base[0]?.text || '');
      pool = [...(P[a] || []), `${w.slice(0, 2).join(' ')} FOREVER`, `STILL ${base[0]?.text || ''}`, `${base[0]?.text || ''} SZN`];
      angleFor = () => a;
      note = `More like “${base[0]?.text || 'that line'}”: same angle, new words.`;
    } else if (act?.kind === 'mix') {
      const base = s.lines.filter(l => (act.lineIds || []).includes(l.id)).slice(0, 2);
      if (base.length < 2) return [400, { ok: false, error: 'Pick two lines to mix.' }];
      pool = mixOf(base[0], base[1]);
      angleFor = i => (i % 2 ? base[1].angle : base[0].angle);
      note = `Mixed “${base[0].text}” with “${base[1].text}”.`;
    } else {
      const hit = Object.keys(P).find(k => new RegExp(k === 'pun' ? 'pun|wordplay' : k === 'emotional' ? 'emotion|heart' : k, 'i').test(prompt));
      pool = hit ? P[hit] : [];
      angleFor = () => POOL_ANGLE[hit] || hit || 'callback';
      note = `Played on “${prompt.slice(0, 60)}”. Numbers only from the headlines and the fact check.`;
    }
    const free = scenario === 'free';
    const capped = body.designMode === 'pro' && scenario === 'pro-cap';
    const tagged = pool.map((t, i) => [t, angleFor(i)]);
    const picked = pick(free ? Object.values(P).map(x => [x[x.length - 1], 'callback']) : tagged.concat(allOf(P)), s.lines, free ? 3 : 4 + (s.lines.length % 3));
    const by = ME;
    const at = new Date().toISOString();
    const fresh = picked.map(([t, a]) => line(t, a, by, free ? 'code' : 'ai', { at, why: free ? 'A quick pick from the headline, made without AI.' : (s.packers ? PACKERS.why[a] : '') || GENERIC_WHY[a] || 'Fits the moment and the ES voice.', rights: s.packers ? PACKERS.rights[t] || [] : [] }));
    const mode = free ? 'basic' : body.designMode === 'pro' && !capped ? 'pro' : 'basic';
    const finalNote = free ? 'Free mode: no AI this time. These are quick picks made from the headline in code.' : capped ? `Pro is paused (this week’s AI limit), so Basic wrote these. ${note}` : note;
    s.lines.push(...fresh);
    if (!free) fresh.forEach(l => { l.designMode = mode; });
    s.turns.push({ id: `bt-${++lineSeq}`, by, at, ...(act ? { action: act } : { prompt }), note: finalNote, lineIds: fresh.map(l => l.id), designMode: mode, ai: !free, ...(free ? { fellBack: 'free' } : capped ? { fellBack: 'cap' } : {}) });
    s.turns = s.turns.slice(-40);
    s.updatedAt = at;
    return [200, { ok: true, lines: fresh, note: finalNote, session: publicSession(s), designMode: mode, ...(free ? { free: true, fellBack: 'free' } : capped ? { fellBack: 'cap' } : {}), cost: { usd: 0, cached: false } }];
  }
  function brainstorm(m, body, scenario) {
    if (m === 'brainstorm-list') return [200, { ok: true, storage: 'db', sessions: [...sessions.values()].map(({ session: s }) => ({ id: s.id, key: s.key, trendId: s.trendId, title: s.title, sport: s.sport, lines: s.lines.length, starred: s.lines.filter(l => l.starred.length).length, updatedAt: s.updatedAt, people: peopleOf(s).length })).sort((x, y) => String(y.updatedAt).localeCompare(x.updatedAt)).slice(0, 20) }];
    if (m === 'brainstorm-open') {
      const trend = body.trend && typeof body.trend === 'object' ? body.trend : null;
      const text = String(body.content?.text || '').trim();
      if (!trend && text.length < 2) return [400, { ok: false, error: 'Pick a moment or write a line first.' }];
      const key = trend?.id ? String(trend.id) : `line:${hashKey(text)}`;
      const created = !sessions.has(key);
      const e = sessions.get(key) || seed(key, trend, body.content);
      return [200, { ok: true, created, session: publicSession(e.session), context: { ...e.context }, me: ME, cost: { usd: 0, cached: true } }];
    }
    if (m === 'brainstorm-get') {
      const e = [...sessions.values()].find(x => x.session.id === body.sessionId);
      if (!e) return [404, { ok: false, reason: 'not-found', error: 'This board is gone. Open it again from the moment.' }];
      return [200, { ok: true, session: publicSession(e.session), ...(body.withContext ? { context: { ...e.context } } : {}) }];
    }
    if (m === 'brainstorm-turn') return turn(body, scenario);
    const entry = [...sessions.values()].find(e => e.session.id === body.sessionId);
    if (!entry) return [404, { ok: false, reason: 'not-found', error: 'This board is gone. Open it again from the moment.' }];
    const s = entry.session;
    if (m === 'brainstorm-add') {
      const t = String(body.text || '').trim().replace(/\s+/g, ' ');
      if (t.length < 1 || t.length > 60) return [400, { ok: false, reason: 'input', error: 'Keep your line to 60 characters.' }];
      if (BANNED_LINE.test(t)) return [400, { ok: false, reason: 'rules', error: 'No league names or “official” on ES merch.' }];
      if (s.lines.some(l => normLine(l.text) === normLine(t))) return [400, { ok: false, reason: 'duplicate', error: 'That line is already on the board.' }];
      const added = line(t, 'callback', ME, 'person');
      s.lines.push(added);
      s.updatedAt = new Date().toISOString();
      return [200, { ok: true, line: { ...added }, session: publicSession(s) }];
    }
    if (m === 'brainstorm-line') {
      const l = s.lines.find(x => x.id === body.lineId);
      if (!l) return [404, { ok: false, reason: 'not-found', error: 'That line was removed.' }];
      if (body.op === 'star' && !l.starred.includes(ME)) l.starred.push(ME);
      else if (body.op === 'unstar') l.starred = l.starred.filter(x => x !== ME);
      else if (body.op === 'edit') {
        const t = String(body.text || '').trim().replace(/\s+/g, ' ');
        if (l.by !== ME) return [403, { ok: false, reason: 'forbidden', error: 'Only the person who added this line (or an admin) can change it.' }];
        if ((l.source === 'person' ? t.length > 60 : !okLine(t)) || BANNED_LINE.test(t)) return [400, { ok: false, reason: 'rules', error: BANNED_LINE.test(t) ? 'No league names or “official” on ES merch.' : 'Keep a line to 32 characters and 6 words.' }];
        l.text = l.source === 'person' ? t : t.toUpperCase();
        l.edited = true;
      } else if (body.op === 'remove') {
        if (l.by !== ME && scenario !== 'admin') return [403, { ok: false, reason: 'forbidden', error: 'Only the person who added this line (or an admin) can change it.' }];
        s.lines = s.lines.filter(x => x !== l);
      }
      s.updatedAt = new Date().toISOString();
      return [200, { ok: true, session: publicSession(s) }];
    }
    return [400, { ok: false, error: 'Unknown brainstorm action.' }];
  }
  // A teammate adds a line (the UI check uses it to test the 20 s refresh).
  function teammateAdds(sessionId, text) {
    const e = [...sessions.values()].find(x => x.session.id === sessionId);
    if (!e) return false;
    e.session.lines.push(line(text, 'chant', MAYA, 'person'));
    e.session.updatedAt = new Date().toISOString();
    return true;
  }
  // reply(body, scenario) -> [httpStatus, json]. Shapes follow netlify/functions/merch.js.
  function reply(body = {}, scenario = 'ok') {
    const m = body.mode;
    const pushModes = ['upload-url', 'upload-relay', 'register', 'preview', 'create', 'publish', 'hide', 'archive', 'collection-create', 'collection-set'];
    if (scenario === 'not-set-up' && (pushModes.includes(m) || m === 'templates' || m === 'product')) return [503, { ok: false, reason: 'not-set-up', error: 'Fourthwall isn’t set up yet. Ask an admin to add FOURTHWALL_API_USERNAME / PASSWORD in Vercel.' }];
    if (scenario === 'error' && m !== 'status') return [502, { ok: false, reason: 'fourthwall', error: 'Fourthwall didn’t answer. Try again in a moment.' }];
    if (scenario === 'cant-push' && pushModes.includes(m)) return [403, { ok: false, reason: 'cant-push', error: 'Only admins can put merch on Fourthwall. Ask an admin to publish this.' }];
    if (scenario === 'cap' && m === 'create') return [429, { ok: false, reason: 'daily-cap', error: 'You’ve sent 10 products to the shop today, the daily limit. More tomorrow.' }];
    if (/^brainstorm-/.test(m || '')) return brainstorm(m, body, scenario);
    switch (m) {
      case 'status': return [200, { ok: true, configured: scenario !== 'not-set-up', shop: scenario === 'not-set-up' ? null : { name: 'Sample shop', publicDomain: 'sample-shop.example', status: 'ACTIVE' }, canPush: scenario !== 'cant-push', canArchive: scenario !== 'cant-push', history: scenario === 'no-db' ? 'memory' : 'db', caps: { person: { used: 0, limit: 10, left: 10 }, team: { used: 0, limit: 30, left: 30 } }, rightsPolicy: 'acknowledge', blanks: TEMPLATES.map(t => t.kind), notice: '' }];
      case 'templates': return [200, { ok: true, templates: body.blank ? TEMPLATES.filter(t => t.blank === body.blank) : TEMPLATES }];
      case 'concepts': return concepts(body, scenario);
      case 'refine': return refine(body, scenario);
      case 'moments': return scenario === 'no-moments' ? [200, { ok: true, moments: [], error: 'Trends are unavailable right now.', at: new Date().toISOString(), cached: false }] : [200, { ok: true, moments: MOMENTS.filter(m => !body.sport || m.sport === body.sport).map(m => ({ ...m, trend: { ...m.trend } })), at: new Date().toISOString(), cached: true, ai: false, cost: { usd: 0, cached: true } }];
      case 'copy': {
        const t = TEMPLATES.find(x => x.blank === body.blank) || TEMPLATES[0];
        const name = { tee: 'Tee', longsleeve: 'Long Sleeve Tee', crewneck: 'Crewneck', hoodie: 'Hoodie', tank: 'Tank', youth: 'Youth Tee', tote: 'Tote', poster: 'Poster', sticker: 'Sticker', mug: 'Mug' }[t.blank];
        return [200, { ok: true, ai: true, copy: { title: `${body.concept?.title || 'ES'} ${name}`, description: `Wear the line fans can’t stop saying. The ES stacked-pill design on a ${t.label.toLowerCase()}. Made to order.`, retail: t.suggestedPrice, base: t.basePrice, margin: Math.round((t.suggestedPrice - t.basePrice) * 100) / 100 }, cost: { usd: 0, cached: true } }];
      }
      case 'upload-url': return [200, { ok: true, uploadUrl: '/__qa/upload', fileUrl: 'https://storage.example/sample.png', expiresAt: null, method: 'PUT' }];
      case 'upload-relay': return /^merch-art\/|^[\w-]+\/[\w.-]+\.png$/.test(String(body.path || '')) && body.uploadUrl && Number(body.size) > 0 ? [200, { ok: true }] : [400, { ok: false, error: 'Missing the uploaded file.' }];
      case 'register': return [200, { ok: true, imageId: 'img_' + Math.random().toString(36).slice(2, 9) }];
      case 'preview': {
        const picked = colorsFor(body);
        if (picked.error) return [400, { ok: false, reason: 'colors', error: picked.error }];
        return [200, { ok: true, customizationId: 'cus_sample', images: Array.isArray(body.colors) ? imagesFor(picked.colors) : IMAGES, color: picked.colors[0], colors: picked.colors }];
      }
      case 'create': {
        const picked = colorsFor(body);
        if (picked.error) return [400, { ok: false, reason: 'colors', error: picked.error }];
        product = { id: 'prod_' + Date.now().toString(36), state: 'HIDDEN' };
        const retail = Number(body.retail) || 30;
        const base = (TEMPLATES.find(x => x.blank === body.blank) || TEMPLATES[0]).basePrice;
        if (Array.isArray(body.collectionIds)) memberOf[product.id] = body.collectionIds.slice();
        LIST.unshift({ productId: product.id, title: body.title, url: SHOP + 'sample-product', state: 'HIDDEN', thumb: MOCK, blank: body.blank || 'tee', color: picked.colors.join(', '), createdAt: new Date().toISOString(), createdBy: 'qa@essentiallysports.com', units30: 0, revenue30: 0 });
        return [200, { ok: true, productId: product.id, state: 'HIDDEN', title: body.title, description: body.description, images: Array.isArray(body.colors) ? imagesFor(picked.colors) : IMAGES, colors: picked.colors, price: { retail, base, margin: Math.round((retail - base) * 100) / 100 }, ack: body.ack, productUrl: SHOP + 'sample-product', collectionIds: memberOf[product.id] || [], caps: { person: { used: 1, limit: 10, left: 9 }, team: { used: 1, limit: 30, left: 29 } } }];
      }
      case 'publish': case 'hide': {
        const state = m === 'publish' ? 'PUBLIC' : 'HIDDEN';
        if (product) product.state = state;
        return [200, { ok: true, state, product: { id: body.productId, state, url: 'https://sample-shop.example/products/sample-product', images: IMAGES } }];
      }
      case 'product': {
        const row = LIST.find(p => p.productId === body.productId);
        const state = product?.id === body.productId ? product.state : row?.state || 'HIDDEN';
        return [200, { ok: true, product: { id: body.productId, productId: body.productId, state, url: row?.url || SHOP + 'sample-product', images: IMAGES, thumb: MOCK, refreshed: Boolean(body.refresh), collectionIds: memberOf[body.productId] || [] } }];
      }
      case 'archive': {
        if (body.confirm !== true) return [400, { ok: false, reason: 'confirm', error: 'Archiving is permanent. Confirm it first.' }];
        const row = LIST.find(p => p.productId === body.productId);
        if (!row) return [409, { ok: false, reason: 'not-ours', error: 'FrameUp only archives products it made. Archive this one in the Fourthwall dashboard.' }];
        if (body.confirmName != null && String(body.confirmName).trim().toLowerCase() !== String(row.title).trim().toLowerCase()) return [400, { ok: false, reason: 'confirm', error: 'The name you typed does not match the product. Type it exactly to archive.' }];
        if (row) row.state = 'ARCHIVED';
        if (product?.id === body.productId) product.state = 'ARCHIVED';
        return [200, { ok: true, product: { productId: body.productId, id: body.productId, title: row.title, state: 'archived' } }];
      }
      case 'list': return scenario === 'empty-list' ? [200, { ok: true, products: [], source: 'db' }] : [200, { ok: true, products: listNow(), source: scenario === 'no-db' ? 'fourthwall' : 'db' }];
      case 'collections': return [200, { ok: true, collections: COLLECTIONS.map(c => ({ ...c })) }];
      case 'collection-create': {
        const name = String(body.name || '').trim().slice(0, 60);
        if (name.length < 2) return [400, { ok: false, error: 'Give the collection a name.' }];
        const same = COLLECTIONS.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (same) return [200, { ok: true, collection: { ...same }, existed: true }];
        const collection = { id: 'col_' + name.toLowerCase().replace(/\W+/g, '-').slice(0, 24) + '_' + COLLECTIONS.length, name, count: 0 };
        COLLECTIONS.push(collection);
        return [200, { ok: true, collection }];
      }
      case 'collection-set': {
        const ids = (Array.isArray(body.collectionIds) ? body.collectionIds : []).filter(id => COLLECTIONS.some(c => c.id === id));
        memberOf[body.productId] = ids;
        return [200, { ok: true, collections: COLLECTIONS.map(c => ({ ...c, has: ids.includes(c.id) })), changed: ids }];
      }
      case 'sales': {
        const rows = LIST.filter(p => !body.productId || p.productId === body.productId).map(p => ({ productId: p.productId, units7: Math.round(p.units30 / 3), revenue7: Math.round(p.revenue30 / 3 * 100) / 100, units30: p.units30, revenue30: p.revenue30, unitsAll: p.units30 + 2, revenueAll: Math.round((p.revenue30 * 1.2) * 100) / 100 }));
        return [200, { ok: true, products: rows, updatedAt: new Date().toISOString(), source: 'db' }];
      }
      default: return [200, { ok: true }];
    }
  }
  // Sample stand-in for Supabase Storage (merch-art/<user>/<file>.png): records the path only.
  const stored = [];
  async function storageUpload(path, blob) { stored.push({ path, size: blob?.size || 0 }); return { path }; }
  root.MerchDemo = { BRAINSTORM_ME: ME, teammateAdds, TEMPLATES, CONCEPTS, PRO_CONCEPTS, MOMENTS, PLAN, TRENDS, COLLECTIONS, LIST, stored, storageUpload, reply };
}(typeof self !== 'undefined' ? self : this));
