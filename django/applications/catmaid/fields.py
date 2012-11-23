from django import forms
from django.db import models
from widgets import Double3DWidget, Integer3DWidget

import ast

class Integer3DFormField(forms.MultiValueField):
    widget = Integer3DWidget

    def __init__(self, *args, **kwargs):
        fields = (
            forms.IntegerField(label='X'),
            forms.IntegerField(label='Y'),
            forms.IntegerField(label='Z'),
        )
        super(Integer3DFormField, self).__init__(fields, *args, **kwargs)

    def compress(self, data_list):
        if data_list:
            return data_list
        return [None, None, None]

class Double3DFormField(forms.MultiValueField):
    widget = Double3DWidget

    def __init__(self, *args, **kwargs):
        fields = (
            forms.FloatField(label='X'),
            forms.FloatField(label='Y'),
            forms.FloatField(label='Z'),
        )
        super(Double3DFormField, self).__init__(fields, *args, **kwargs)

    def compress(self, data_list):
        if data_list:
            return data_list
        return [None, None, None]

class ArrayFieldBase(models.Field):
    """ Base class for field types mapping to PostgreSQL's
    array types.
    """

    def to_python(self, value):
        """ Converts database objects to Python objects.
        """
        if isinstance(value, basestring):
            value = ast.literal_eval(value)
        return value

    def get_prep_value(self, value):
        """ Prepares Python objects before conversion to
        database objects.
        """
        if value == "":
            value = "{}"
        return value

class TextArrayField(ArrayFieldBase):
    """ A text array field that maps to PostgreSQL's text[] type.
    """
    description = 'Text array'

    def db_type(self, connection):
        return 'text[]'
