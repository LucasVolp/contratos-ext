import type { ComponentProps } from "react";
import { Search } from "lucide-react";
import { Input } from "./input";
import { Label } from "./label";

type SearchFieldProps = ComponentProps<typeof Input> & {
  id: string;
  label: string;
};

export function SearchField({ id, label, ...props }: SearchFieldProps) {
  return (
    <div className="search-control">
      <Label htmlFor={id}>{label}</Label>
      <div className="search-field">
        <Search size={17} aria-hidden="true" />
        <Input id={id} aria-label={label} {...props} />
      </div>
    </div>
  );
}
