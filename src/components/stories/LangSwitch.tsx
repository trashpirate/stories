import { useLang, type Lang } from "@/lib/stories/lang";
import { t } from "@/lib/stories/copy";

export function LangSwitch() {
  const [lang, setLang] = useLang();
  const text = t(lang);
  const choices: Lang[] = ["en", "de"];
  return (
    <div className="lang-switch" role="group" aria-label={text.language}>
      {choices.map((item) => (
        <button key={item} type="button" className="tap" aria-pressed={lang === item} onClick={() => setLang(item)}>
          {item === "en" ? "EN" : "DE"}
        </button>
      ))}
    </div>
  );
}
