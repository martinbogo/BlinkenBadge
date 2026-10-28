import privacy from "./privacy.json";

export default function PrivacyNotice() {
  return (
    <div>
      <p>Updated {privacy.updated}.</p>
      {privacy.sections.map((section) => (
        <section key={section.title}>
          <h3>{section.title}</h3>
          <p>{section.text}</p>
        </section>
      ))}
      <p>
        Contact Martin Bogomolni through the BlinkenBadge repository on GitHub.
      </p>
    </div>
  );
}
