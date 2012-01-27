from django.core.management.base import BaseCommand, CommandError
from vncbrowser.models import Message, User

class Command(BaseCommand):
    args = '<user_id> <title> <text> <action>'
    help = 'Adds a new unread message for the spefied user'

    def handle(self, *args, **options):
        if len(args) != 4:
           raise CommandError('Wrong number of arguments. Please use: ' + Command.args) 
        user_id = args[0]
        title = args[1]
        text = args[2]
        action = args[3]
        user = None
        try:
            user = User.objects.get(pk=int(user_id))
        except User.DoesNotExist:
            raise CommandError('User "%s" does not exist' % user_id)

        msg = Message()
        msg.user = user
        msg.read = False
        msg.title = title
        msg.text = text
        msg.action = action
        msg.save()

        self.stdout.write('Successfully added message for user "%s"\n' % user_id)
