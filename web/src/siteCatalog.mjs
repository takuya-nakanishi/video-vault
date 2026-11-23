// URL の判定表。Android の domain/SiteCatalog.kt と同じ規則で、同じ JSON(assets/site_patterns.json)を読む。
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS_DIR } from './config.mjs';
import { hostOf } from './inputClassifier.mjs';

export class SiteCatalog {
  /** @param {{id:string,name:string,hosts:string[],downloadable:boolean,reason?:string}[]} rules */
  constructor(rules) {
    this.rules = rules;
  }

  /** ホスト名に当たる規則。先に書かれた規則が勝つ。hosts は後方一致で、サブドメインにも当たる */
  ruleFor(host) {
    const target = host.toLowerCase().replace(/^www\./, '');
    return (
      this.rules.find((rule) =>
        rule.hosts.some((pattern) => {
          const p = pattern.toLowerCase();
          return target === p || target.endsWith(`.${p}`);
        }),
      ) ?? null
    );
  }

  /** 履歴に残すサイト名。判定表に無いサイトはホスト名(`www.` 抜き)で代用する */
  nameForUrl(url) {
    const host = hostOf(url);
    if (!host) return url;
    return this.ruleFor(host)?.name ?? host.replace(/^www\./, '');
  }

  static EMPTY = new SiteCatalog([]);

  static parse(json) {
    const sites = Array.isArray(json?.sites) ? json.sites : [];
    return new SiteCatalog(
      sites
        .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.hosts))
        .map((s) => ({
          id: s.id,
          name: s.name,
          hosts: s.hosts.filter((h) => typeof h === 'string'),
          downloadable: s.downloadable !== false,
          reason: typeof s.reason === 'string' ? s.reason : undefined,
        })),
    );
  }

  /** 判定表を読めなければ空(全 URL が「ブラウザで開く」に落ちる)。Android の SiteCatalogLoader と同じ退避 */
  static load(file = path.join(ASSETS_DIR, 'site_patterns.json')) {
    try {
      return SiteCatalog.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      console.error(`判定表を読めない(${file}): ${e.message}`);
      return SiteCatalog.EMPTY;
    }
  }
}
