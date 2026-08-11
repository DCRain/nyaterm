import * as React from "react";
import { MdAdd, MdRemove } from "react-icons/md";
import { Button } from "./button";
import { Input } from "./input";

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, value, onChange, min = -Infinity, max = Infinity, step = 1, ...props }, ref) => {
    const [inputValue, setInputValue] = React.useState(() => String(value));
    const [isFocused, setIsFocused] = React.useState(false);

    React.useEffect(() => {
      if (!isFocused) {
        setInputValue(String(value));
      }
    }, [isFocused, value]);

    const commitValue = (nextValue: number) => {
      const clampedValue = Math.min(max, Math.max(min, nextValue));
      onChange(clampedValue);
      setInputValue(String(clampedValue));
    };

    const handleIncrement = () => {
      const newValue = value + step;
      if (newValue <= max) commitValue(newValue);
    };

    const handleDecrement = () => {
      const newValue = value - step;
      if (newValue >= min) commitValue(newValue);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
      const val = Number.parseInt(e.target.value, 10);
      if (!Number.isNaN(val)) onChange(val);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      const val = Number.parseInt(e.target.value, 10);
      commitValue(Number.isNaN(val) ? value : val);
      props.onBlur?.(e);
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      props.onFocus?.(e);
    };

    return (
      <div className={`flex items-center ${className || ""}`}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleDecrement}
          disabled={props.disabled || value <= min}
          className="rounded-r-none shrink-0 border-r-0 focus-visible:z-10 bg-muted/20"
        >
          <MdRemove className="text-sm" />
        </Button>
        <Input
          {...props}
          type="number"
          ref={ref}
          value={value === 0 && min > 0 && !isFocused ? "" : inputValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          className="rounded-none text-center px-1 w-full focus-visible:z-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          min={min}
          max={max}
          step={step}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleIncrement}
          disabled={props.disabled || value >= max}
          className="rounded-l-none shrink-0 border-l-0 focus-visible:z-10 bg-muted/20"
        >
          <MdAdd className="text-sm" />
        </Button>
      </div>
    );
  },
);
NumberInput.displayName = "NumberInput";
