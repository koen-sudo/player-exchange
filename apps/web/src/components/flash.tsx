/** Result message carried in the URL after a server action (?melding= / ?fout=). */
export function Flash({ melding, fout }: { melding?: string; fout?: string }) {
  if (fout) return <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-down">{fout}</p>;
  if (melding) return <p role="status" className="mb-4 rounded-lg bg-primary-soft px-4 py-3 text-sm">{melding}</p>;
  return null;
}
