// Constants for declaration categories
export const CAT_namespace = 0;
export const CAT_container = 1; // Likely includes structs, unions, opaque types
export const CAT_global_variable = 2;
export const CAT_function = 3;
export const CAT_primitive = 4;
export const CAT_error_set = 5;
export const CAT_global_const = 6;
export const CAT_alias = 7;
export const CAT_type = 8; // Could be enum, struct, union, etc. Needs fields/members check
export const CAT_type_type = 9; // e.g., Type
export const CAT_type_function = 10; // e.g., @Type